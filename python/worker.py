"""DevNote Python worker — JSON-RPC over stdin/stdout.

Invoked by the TS extension as a child process. Reads newline-delimited JSON
messages from stdin, writes newline-delimited JSON responses to stdout.

Requests:  {"id": "1", "method": "embed", "params": {"text": "..."}}
Responses: {"id": "1", "result": ...}  OR  {"id": "1", "error": "..."}
"""

import sys
import json
import base64
from typing import Any

from google import genai
from google.genai import types
import numpy as np

MODEL_NAME = "gemini-embedding-001"
EMBEDDING_DIM = 3072

PRIMARY_CHAT_MODEL = "gemini-2.5-flash"
FALLBACK_CHAT_MODEL = "gemini-2.5-flash-lite"
CHAT_TEMPERATURE = 0.1
CHAT_MAX_OUTPUT_TOKENS = 1024

# Sentinel returned by streaming handlers — tells main() the response was already written
_STREAM_HANDLED: dict = {"__stream_handled__": True}


def _emit_stream_message(msg_id: Any, payload: dict) -> None:
    """Write one streaming JSON message and flush stdout immediately.

    Without flush(), OS line-buffering holds chunks for seconds → user sees a wall
    of text instead of a smooth stream (Lesson 4 streaming gotcha #2).
    """
    sys.stdout.write(json.dumps({"id": msg_id, **payload}) + "\n")
    sys.stdout.flush()


def _stream_with_model(model_name: str, prompt: str, msg_id: Any) -> str:
    """Stream one Gemini chat call. Emits stream messages per chunk; returns assembled text."""
    if client is None:
        raise RuntimeError("Gemini client not configured. Call configure first.")
    config = types.GenerateContentConfig(
        temperature=CHAT_TEMPERATURE,
        max_output_tokens=CHAT_MAX_OUTPUT_TOKENS,
    )
    final_parts: list[str] = []
    for chunk in client.models.generate_content_stream(
        model=model_name,
        contents=prompt,
        config=config,
    ):
        text = getattr(chunk, "text", None)
        if text:
            final_parts.append(text)
            _emit_stream_message(msg_id, {"type": "stream", "text": text})
    return "".join(final_parts)


def stream_generate(prompt: str, msg_id: Any) -> dict:
    """Try Flash first; fall back to Flash-Lite on any error. Emits final 'done' or 'error'."""
    try:
        final_text = _stream_with_model(PRIMARY_CHAT_MODEL, prompt, msg_id)
        _emit_stream_message(msg_id, {
            "type": "done",
            "result": {"final": final_text, "model": PRIMARY_CHAT_MODEL},
        })
        return _STREAM_HANDLED
    except Exception as primary_err:
        try:
            final_text = _stream_with_model(FALLBACK_CHAT_MODEL, prompt, msg_id)
            _emit_stream_message(msg_id, {
                "type": "done",
                "result": {
                    "final": final_text,
                    "model": FALLBACK_CHAT_MODEL,
                    "fallback_reason": str(primary_err),
                },
            })
            return _STREAM_HANDLED
        except Exception as fallback_err:
            _emit_stream_message(msg_id, {
                "error": f"Both chat models failed. Primary: {primary_err}. Fallback: {fallback_err}",
            })
            return _STREAM_HANDLED


class VectorStore:
    """In-memory mirror of the SQLite embedding column, optimized for search."""

    def __init__(self) -> None:
        self.ids: list[str] = []
        self.matrix: np.ndarray = np.zeros((0, EMBEDDING_DIM), dtype=np.float32)

    def load_from(self, rows: list[tuple[str, np.ndarray]]) -> None:
        """Warm-load at worker startup. `rows` is [(id, vec_768), ...]."""
        if not rows:
            self.ids = []
            self.matrix = np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
            return
        self.ids = [r[0] for r in rows]
        self.matrix = np.vstack([r[1].astype(np.float32) for r in rows])

    def append(self, note_id: str, vec: np.ndarray) -> None:
        """Append one new vector (called after a sync embeds a new note)."""
        v = vec.astype(np.float32).reshape(1, EMBEDDING_DIM)
        if self.matrix.shape[0] == 0:
            self.matrix = v
        else:
            self.matrix = np.vstack([self.matrix, v])
        self.ids.append(note_id)

    def count(self) -> int:
        return len(self.ids)


store = VectorStore()

client: genai.Client | None = None


def configure_api(api_key: str) -> None:
    global client
    client = genai.Client(api_key=api_key)


def embed_text(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """Embed a single piece of text via Gemini. Returns 768 floats."""
    if client is None:
        raise RuntimeError("Gemini client not configured. Call configure_api first.")
    response = client.models.embed_content(
        model=MODEL_NAME,
        contents=text,
        config=types.EmbedContentConfig(task_type=task_type.upper()),
    )
    return list(response.embeddings[0].values)


def batch_embed_texts(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed multiple texts in one API call. Gemini accepts up to 100 per batch."""
    if client is None:
        raise RuntimeError("Gemini client not configured. Call configure_api first.")
    response = client.models.embed_content(
        model=MODEL_NAME,
        contents=texts,
        config=types.EmbedContentConfig(task_type=task_type.upper()),
    )
    return [list(e.values) for e in response.embeddings]


def search(query_vec: np.ndarray, k: int = 5, threshold: float = 0.35) -> list[tuple[str, float]]:
    """Top-k search via dot product (≡ cosine on L2-normalized vectors).

    Returns list of (id, score) tuples, sorted by score DESC, filtered by threshold.
    """
    if store.count() == 0:
        return []

    # Dot product — embeddings are pre-normalized by embedding-001
    scores = store.matrix @ query_vec.astype(np.float32)

    # argpartition for O(N) top-k, then sort just those k
    k_actual = min(k, store.count())
    top_unsorted = np.argpartition(-scores, k_actual - 1)[:k_actual] if k_actual > 0 else np.array([], dtype=int)
    top_sorted = top_unsorted[np.argsort(-scores[top_unsorted])]

    results = [(store.ids[i], float(scores[i])) for i in top_sorted]
    return [(nid, s) for nid, s in results if s >= threshold]


def _decode_blob(b64: str) -> np.ndarray:
    """Decode a base64-encoded Float32Array BLOB back to numpy array."""
    raw = base64.b64decode(b64)
    return np.frombuffer(raw, dtype=np.float32)


def _encode_vec(vec: list[float]) -> str:
    """Encode a list of floats as base64 Float32Array for BLOB storage."""
    arr = np.array(vec, dtype=np.float32)
    return base64.b64encode(arr.tobytes()).decode("ascii")


def handle_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Route one JSON-RPC message to the right handler."""
    msg_id = msg.get("id", "")
    method = msg.get("method", "")
    params = msg.get("params", {}) or {}

    try:
        if method == "configure":
            # Called once at worker startup with the Gemini API key
            configure_api(params["api_key"])
            return {"id": msg_id, "result": {"ok": True}}

        if method == "warm_load":
            # Load all embeddings from SQLite (sent as [id, base64_blob] pairs)
            rows_raw = params.get("rows", [])
            rows = [(r[0], _decode_blob(r[1])) for r in rows_raw]
            store.load_from(rows)
            return {"id": msg_id, "result": {"loaded": store.count()}}

        if method == "embed":
            vec = embed_text(params["text"])
            return {"id": msg_id, "result": {"embedding": vec, "model": MODEL_NAME}}

        if method == "embed_and_append":
            # Embed a new note and append to the in-memory matrix
            vec = embed_text(params["text"])
            store.append(params["id"], np.array(vec, dtype=np.float32))
            return {"id": msg_id, "result": {"embedding": vec, "model": MODEL_NAME}}

        if method == "batch_embed":
            # For backfill: embed up to 100 texts in one call
            texts = params["texts"]
            vectors = batch_embed_texts(texts)
            return {"id": msg_id, "result": {"embeddings": vectors, "model": MODEL_NAME}}

        if method == "search":
            query_text = params["query"]
            k = int(params.get("k", 5))
            threshold = float(params.get("threshold", 0.35))
            query_vec = np.array(embed_text(query_text, task_type="RETRIEVAL_QUERY"), dtype=np.float32)
            results = search(query_vec, k=k, threshold=threshold)
            return {"id": msg_id, "result": {"results": [{"id": nid, "score": s} for nid, s in results]}}

        if method == "stats":
            return {"id": msg_id, "result": {"count": store.count(), "model": MODEL_NAME}}

        if method == "stream_generate":
            prompt = params["prompt"]
            return stream_generate(prompt, msg_id)

        return {"id": msg_id, "error": f"unknown method: {method}"}

    except Exception as e:
        return {"id": msg_id, "error": str(e)}


def main() -> None:
    """Read JSON-RPC from stdin forever, write responses to stdout."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            # Can't reply without an ID — log to stderr and keep going
            print(f"[worker] JSON decode error: {e}", file=sys.stderr, flush=True)
            continue
        response = handle_message(msg)
        if response is None or response.get("__stream_handled__"):
            continue   # streaming handler already wrote its own messages
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
