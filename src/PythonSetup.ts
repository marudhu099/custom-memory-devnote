import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 10;

export interface PythonInfo {
  path: string;
  version: string;
  majorMinor: [number, number];
}

/**
 * Scan for a working Python 3.10+ interpreter on the user's machine.
 * Returns null if not found, otherwise the path + version.
 */
export async function detectPython(): Promise<PythonInfo | null> {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    try {
      const info = await checkPythonVersion(candidate);
      if (info && info.majorMinor[0] > MIN_PYTHON_MAJOR ||
          (info && info.majorMinor[0] === MIN_PYTHON_MAJOR && info.majorMinor[1] >= MIN_PYTHON_MINOR)) {
        return info;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function checkPythonVersion(pythonPath: string): Promise<PythonInfo | null> {
  return new Promise((resolve) => {
    const child = spawn(pythonPath, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")']);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const versionStr = stdout.trim();
      const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        resolve(null);
        return;
      }
      resolve({
        path: pythonPath,
        version: versionStr,
        majorMinor: [parseInt(match[1], 10), parseInt(match[2], 10)],
      });
    });
    child.on('error', () => resolve(null));
  });
}

/**
 * Create a venv at `venvPath` using the given Python interpreter.
 * Resolves with void on success, rejects on failure.
 */
export function createVenv(pythonPath: string, venvPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ['-m', 'venv', venvPath]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`venv creation failed (exit ${code}): ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

/**
 * Return the path to the venv's python binary.
 */
export function venvPython(venvPath: string): string {
  return process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

/**
 * pip-install from a requirements.txt into the venv.
 */
export function pipInstall(venvPath: string, requirementsPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const py = venvPython(venvPath);
    const child = spawn(py, ['-m', 'pip', 'install', '-r', requirementsPath]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pip install failed (exit ${code}): ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

/**
 * Delete the venv directory (best-effort).
 */
export function deleteVenv(venvPath: string): void {
  if (fs.existsSync(venvPath)) {
    fs.rmSync(venvPath, {
      recursive: true,
      force: true,
      maxRetries: 3,      // Windows: retry if .pyd files briefly locked
      retryDelay: 500,    // 500ms between attempts
    });
  }
}

/**
 * Compute standard paths for DevNote's venv inside globalStorageUri.
 */
export function getVenvPaths(context: vscode.ExtensionContext) {
  const venvPath = path.join(context.globalStorageUri.fsPath, 'venv');
  const pythonPath = venvPython(venvPath);
  const requirementsPath = path.join(context.extensionUri.fsPath, 'python', 'requirements.txt');
  const workerPath = path.join(context.extensionUri.fsPath, 'python', 'worker.py');
  return { venvPath, pythonPath, requirementsPath, workerPath };
}
