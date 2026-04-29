"""Unit tests for DevNote Python worker. Run with: pytest python/tests/ -v"""

import sys
import os
import base64
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

# Make worker.py importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import worker


@pytest.fixture(autouse=True)
def reset_store():
    """Reset the module-level store and set up a mock client between tests."""
    worker.store = worker.VectorStore()
    worker.client = MagicMock()
    yield


def test_embed_text_returns_768_floats():
    fake_embedding = MagicMock(values=[0.1] * worker.EMBEDDING_DIM)
    fake_response = MagicMock(embeddings=[fake_embedding])
    worker.client.models.embed_content.return_value = fake_response
    result = worker.embed_text("test note")
    assert len(result) == worker.EMBEDDING_DIM
    assert all(isinstance(x, float) for x in result)


def test_batch_embed_returns_multiple_vectors():
    fake_embeddings = [
        MagicMock(values=[0.1] * worker.EMBEDDING_DIM),
        MagicMock(values=[0.2] * worker.EMBEDDING_DIM),
        MagicMock(values=[0.3] * worker.EMBEDDING_DIM),
    ]
    fake_response = MagicMock(embeddings=fake_embeddings)
    worker.client.models.embed_content.return_value = fake_response
    results = worker.batch_embed_texts(["a", "b", "c"])
    assert len(results) == 3
    assert all(len(v) == worker.EMBEDDING_DIM for v in results)


def test_vector_store_warm_load():
    v1 = np.ones(worker.EMBEDDING_DIM, dtype=np.float32)
    v2 = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    worker.store.load_from([("id1", v1), ("id2", v2)])
    assert worker.store.matrix.shape == (2, worker.EMBEDDING_DIM)
    assert worker.store.ids == ["id1", "id2"]


def test_vector_store_append():
    v = np.ones(worker.EMBEDDING_DIM, dtype=np.float32)
    worker.store.append("id1", v)
    assert worker.store.count() == 1
    worker.store.append("id2", v)
    assert worker.store.count() == 2


def test_search_returns_top_k_above_threshold():
    # L2-normalized unit vectors
    v_match = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    v_match[0] = 1.0
    v_related = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    v_related[0] = 0.9
    v_related[1] = np.sqrt(1 - 0.81)  # unit vector tilted off axis 0 → dot(query)=0.9
    v_weak = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    v_weak[0] = 0.3
    v_weak[1] = np.sqrt(1 - 0.09)     # unit vector mostly orthogonal → dot(query)=0.3

    worker.store.load_from([
        ("match", v_match),
        ("related", v_related),
        ("weak", v_weak),
    ])

    query = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    query[0] = 1.0
    results = worker.search(query, k=5, threshold=0.5)

    assert len(results) == 2  # "weak" filtered by threshold
    assert results[0][0] == "match"
    assert results[1][0] == "related"
    assert results[0][1] >= results[1][1]


def test_search_returns_empty_when_all_below_threshold():
    v_unrelated = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    v_unrelated[100] = 1.0
    worker.store.load_from([("foo", v_unrelated)])
    query = np.zeros(worker.EMBEDDING_DIM, dtype=np.float32)
    query[0] = 1.0
    results = worker.search(query, k=5, threshold=0.5)
    assert results == []


def test_search_returns_empty_when_store_empty():
    query = np.ones(worker.EMBEDDING_DIM, dtype=np.float32)
    results = worker.search(query, k=5, threshold=0.0)
    assert results == []


def test_dot_product_equivalent_to_cosine_on_normalized():
    """Sanity check D4: dot product ≡ cosine on L2-normalized vectors."""
    a = np.array([1.0, 2.0, 3.0], dtype=np.float32)
    a /= np.linalg.norm(a)
    b = np.array([2.0, 1.0, 3.0], dtype=np.float32)
    b /= np.linalg.norm(b)
    dot = a @ b
    cos = (a @ b) / (np.linalg.norm(a) * np.linalg.norm(b))
    assert np.isclose(dot, cos)


def test_handle_message_embed_success():
    with patch("worker.embed_text") as mock:
        mock.return_value = [0.5] * worker.EMBEDDING_DIM
        response = worker.handle_message({
            "id": "1", "method": "embed", "params": {"text": "hi"}
        })
        assert response["id"] == "1"
        assert "result" in response
        assert len(response["result"]["embedding"]) == worker.EMBEDDING_DIM
        assert response["result"]["model"] == "gemini-embedding-001"


def test_handle_message_propagates_errors():
    with patch("worker.embed_text", side_effect=RuntimeError("API down")):
        response = worker.handle_message({
            "id": "2", "method": "embed", "params": {"text": "x"}
        })
        assert response["id"] == "2"
        assert "error" in response
        assert "API down" in response["error"]


def test_handle_message_unknown_method():
    response = worker.handle_message({
        "id": "3", "method": "foobar", "params": {}
    })
    assert "error" in response
    assert "unknown method" in response["error"]


def test_blob_encode_decode_roundtrip():
    original = [0.1, 0.2, 0.3, 0.4]
    arr = np.array(original, dtype=np.float32)
    b64 = base64.b64encode(arr.tobytes()).decode("ascii")
    decoded = worker._decode_blob(b64)
    assert np.allclose(decoded, original)


# === stream_generate tests (Task 4) ===

import json


class FakeChunk:
    """Mimics one item from client.models.generate_content_stream(...)."""
    def __init__(self, text: str):
        self.text = text


def _captured_messages(capsys) -> list[dict]:
    """Parse all newline-delimited JSON messages written to stdout in this test."""
    out = capsys.readouterr().out
    return [json.loads(line) for line in out.strip().split("\n") if line.strip()]


def _install_fake_client(monkeypatch, stream_fn):
    """Install a MagicMock client whose generate_content_stream is `stream_fn`."""
    fake_client = MagicMock()
    fake_client.models.generate_content_stream = stream_fn
    monkeypatch.setattr(worker, "client", fake_client)
    return fake_client


def test_stream_generate_happy_path(monkeypatch, capsys):
    """stream_generate emits one stream message per chunk + a terminal done message."""
    chunks = [FakeChunk("Hello "), FakeChunk("world"), FakeChunk("!")]
    _install_fake_client(monkeypatch, lambda **kw: iter(chunks))

    result = worker.stream_generate("Test prompt", msg_id="req-1")

    assert result is worker._STREAM_HANDLED
    msgs = _captured_messages(capsys)
    stream_msgs = [m for m in msgs if m.get("type") == "stream"]
    done_msgs = [m for m in msgs if m.get("type") == "done"]
    assert [m["text"] for m in stream_msgs] == ["Hello ", "world", "!"]
    assert all(m["id"] == "req-1" for m in stream_msgs)
    assert len(done_msgs) == 1
    assert done_msgs[0]["result"]["final"] == "Hello world!"
    assert done_msgs[0]["result"]["model"] == worker.PRIMARY_CHAT_MODEL


def test_stream_generate_empty_stream(monkeypatch, capsys):
    """A stream that yields zero chunks emits no stream messages but still emits done with empty final."""
    _install_fake_client(monkeypatch, lambda **kw: iter([]))

    result = worker.stream_generate("Test", msg_id="req-2")

    assert result is worker._STREAM_HANDLED
    msgs = _captured_messages(capsys)
    stream_msgs = [m for m in msgs if m.get("type") == "stream"]
    done_msgs = [m for m in msgs if m.get("type") == "done"]
    assert stream_msgs == []
    assert len(done_msgs) == 1
    assert done_msgs[0]["result"]["final"] == ""


def test_stream_generate_fallback_on_primary_error(monkeypatch, capsys):
    """When Flash raises, Flash-Lite is invoked and the done message reflects the fallback model."""
    call_log: list[str] = []

    def fake_stream(**kw):
        call_log.append(kw["model"])
        if kw["model"] == worker.PRIMARY_CHAT_MODEL:
            raise RuntimeError("503 overloaded")
        return iter([FakeChunk("from lite")])

    _install_fake_client(monkeypatch, fake_stream)

    result = worker.stream_generate("Q", msg_id="req-3")

    assert result is worker._STREAM_HANDLED
    assert call_log == [worker.PRIMARY_CHAT_MODEL, worker.FALLBACK_CHAT_MODEL]
    msgs = _captured_messages(capsys)
    done_msgs = [m for m in msgs if m.get("type") == "done"]
    assert len(done_msgs) == 1
    assert done_msgs[0]["result"]["model"] == worker.FALLBACK_CHAT_MODEL
    assert "fallback_reason" in done_msgs[0]["result"]


def test_stream_generate_both_models_fail(monkeypatch, capsys):
    """If both primary and fallback raise, stream_generate emits a single error message and returns sentinel."""
    def fake_stream(**kw):
        raise RuntimeError(f"both broken: {kw['model']}")

    _install_fake_client(monkeypatch, fake_stream)

    result = worker.stream_generate("Q", msg_id="req-4")

    assert result is worker._STREAM_HANDLED
    msgs = _captured_messages(capsys)
    error_msgs = [m for m in msgs if "error" in m]
    assert len(error_msgs) == 1
    assert "Both chat models failed" in error_msgs[0]["error"]


def test_stream_generate_requires_configure(monkeypatch, capsys):
    """If client is None, the call falls through to fallback (also None) and emits an error message."""
    monkeypatch.setattr(worker, "client", None)

    result = worker.stream_generate("Q", msg_id="req-5")

    assert result is worker._STREAM_HANDLED
    msgs = _captured_messages(capsys)
    error_msgs = [m for m in msgs if "error" in m]
    assert len(error_msgs) == 1
    assert "not configured" in error_msgs[0]["error"].lower()
