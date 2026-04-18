"""DevNote Python worker — JSON-RPC over stdin/stdout.

Invoked by the TS extension as a child process. Reads newline-delimited JSON
messages from stdin, writes newline-delimited JSON responses to stdout.

Requests:  {"id": "1", "method": "embed", "params": {"text": "..."}}
Responses: {"id": "1", "result": ...}  OR  {"id": "1", "error": "..."}
"""
