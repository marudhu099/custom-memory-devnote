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
    else:
        response = {"id": msg_id, "error": f"unknown method: {method}"}

    print(json.dumps(response), flush=True)
