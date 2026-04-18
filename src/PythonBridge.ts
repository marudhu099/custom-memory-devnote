import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';

const MAX_CRASHES_PER_SESSION = 3;

export interface JsonRpcRequest {
  method: string;
  params?: Record<string, unknown>;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Manages a Python subprocess and routes JSON-RPC messages over stdin/stdout.
 *
 * Lifecycle:
 *   - spawn() — starts the child process
 *   - call() — sends a JSON-RPC request, returns a Promise that resolves with the result
 *   - shutdown() — kills the subprocess
 *
 * Crash recovery: auto-respawns up to MAX_CRASHES_PER_SESSION on unexpected exit.
 * After the limit, calls reject with a clear error until user restarts VS Code.
 */
export class PythonBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingCall>();
  private seq = 0;
  private crashCount = 0;
  private disabled = false;
  private buffer = '';

  constructor(
    private readonly pythonPath: string,
    private readonly workerScriptPath: string
  ) {}

  get available(): boolean {
    return !this.disabled && this.proc !== null && !this.proc.killed;
  }

  async spawn(): Promise<void> {
    if (this.disabled) {
      throw new Error('PythonBridge disabled after repeated crashes. Restart VS Code.');
    }

    this.proc = spawn(this.pythonPath, [this.workerScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      console.error(`[PythonBridge stderr] ${chunk.toString()}`);
    });
    this.proc.on('exit', (code) => this.onExit(code));
    this.proc.on('error', (err) => {
      console.error(`[PythonBridge error]`, err);
    });
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disabled) {
      throw new Error('PythonBridge disabled after repeated crashes. Restart VS Code.');
    }
    if (!this.proc || this.proc.killed) {
      throw new Error('PythonBridge not spawned. Call spawn() first.');
    }

    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, method, params: params ?? {} }) + '\n';
      this.proc!.stdin.write(msg);
    });
  }

  async shutdown(): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
      this.proc = null;
    }
    this.pending.forEach((p) => p.reject(new Error('PythonBridge shut down')));
    this.pending.clear();
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      this.handleResponse(line);
    }
  }

  private handleResponse(line: string): void {
    let msg: { id: string; result?: unknown; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[PythonBridge] invalid JSON from worker: ${line}`);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) {
      console.error(`[PythonBridge] response for unknown id: ${msg.id}`);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.error !== undefined) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  private onExit(code: number | null): void {
    // Reject all pending calls
    const err = new Error(`Python worker exited (code=${code})`);
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
    this.proc = null;

    if (this.crashCount < MAX_CRASHES_PER_SESSION) {
      this.crashCount++;
      vscode.window.showWarningMessage(
        `DevNote search worker restarted (${this.crashCount}/${MAX_CRASHES_PER_SESSION}).`
      );
      // Respawn — caller must re-initialize (warm_load etc.) via SearchService
      void this.spawn();
    } else {
      this.disabled = true;
      vscode.window.showErrorMessage(
        `DevNote search worker is unstable. Restart VS Code or check Python logs.`
      );
    }
  }
}
