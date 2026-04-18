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
