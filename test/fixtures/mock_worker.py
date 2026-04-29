"""Mock Python worker for PythonBridge tests. Echo + error stubs only.
Purpose: exercise PythonBridge without real Gemini dependencies.
"""
import sys
import json

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        continue

    msg_id = msg.get("id", "")
    method = msg.get("method", "")
    params = msg.get("params", {}) or {}

    if method == "echo":
        response = {"id": msg_id, "result": params}
    elif method == "error":
        response = {"id": msg_id, "error": "test error from mock"}
    elif method == "crash":
        sys.exit(1)  # simulate crash
    elif method == "stream_generate":
        chunks = ["Hello ", "from ", "mock"]
        for chunk in chunks:
            sys.stdout.write(json.dumps({"id": msg_id, "type": "stream", "text": chunk}) + "\n")
            sys.stdout.flush()
        sys.stdout.write(json.dumps({
            "id": msg_id,
            "type": "done",
            "result": {"final": "".join(chunks), "model": "mock-flash"},
        }) + "\n")
        sys.stdout.flush()
        continue
    elif method == "error_stream":
        sys.stdout.write(json.dumps({"id": msg_id, "type": "stream", "text": "partial"}) + "\n")
        sys.stdout.flush()
        sys.stdout.write(json.dumps({"id": msg_id, "error": "simulated mid-stream failure"}) + "\n")
        sys.stdout.flush()
        continue
    else:
        response = {"id": msg_id, "error": f"unknown method: {method}"}

    print(json.dumps(response), flush=True)
