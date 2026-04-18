import * as vscode from 'vscode';
import * as fs from 'fs';
import { PythonBridge } from './PythonBridge';
import { MemoryStore } from './MemoryStore';
import { detectPython, createVenv, pipInstall, deleteVenv, getVenvPaths } from './PythonSetup';

const MODEL_NAME = 'embedding-001';
const SEARCH_K = 5;
const SEARCH_THRESHOLD = 0.35;
const BATCH_SIZE = 100;

const STATE_VENV_READY = 'devnote.venvReady';
const STATE_PACKAGES_VERSION = 'devnote.packagesVersion';
const CURRENT_PACKAGES_VERSION = '1.0';

export interface RankedResult {
  id: string;
  score: number;
}

export class SearchService {
  private bridge: PythonBridge | null = null;
  private initialized = false;
  private apiKey: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly memoryStore: MemoryStore,
    apiKey: string
  ) {
    this.apiKey = apiKey;
  }

  async updateApiKey(newKey: string): Promise<void> {
    this.apiKey = newKey;
    if (this.bridge && this.bridge.available) {
      try {
        await this.bridge.call('configure', { api_key: newKey });
      } catch (err) {
        console.error('[SearchService] updateApiKey configure failed:', err);
        // Next ensureReady() will re-configure
      }
    }
  }

  /**
   * Ensures Python, venv, worker, and backfill are all ready before any search.
   * Shows progress notifications. Throws on unrecoverable errors.
   */
  async ensureReady(): Promise<void> {
    // Step 1: check Python 3.10+
    const python = await detectPython();
    if (!python) {
      const choice = await vscode.window.showWarningMessage(
        'DevNote needs Python 3.10+ for semantic search.',
        'Install Guide'
      );
      if (choice === 'Install Guide') {
        void vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
      }
      throw new Error('Python 3.10+ not found');
    }

    // Step 2: check venv
    const paths = getVenvPaths(this.context);
    const venvReady = this.context.globalState.get<boolean>(STATE_VENV_READY) === true;
    const packagesVersion = this.context.globalState.get<string>(STATE_PACKAGES_VERSION);
    const needsSetup = !venvReady || packagesVersion !== CURRENT_PACKAGES_VERSION || !fs.existsSync(paths.pythonPath);

    if (needsSetup) {
      const proceed = await vscode.window.showInformationMessage(
        'First time using search? DevNote will set up its Python environment (one-time, ~30s).',
        'Set Up Now', 'Cancel'
      );
      if (proceed !== 'Set Up Now') {
        throw new Error('User cancelled Python setup');
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'DevNote: setting up Python environment',
        cancellable: false,
      }, async (progress) => {
        progress.report({ message: 'Creating venv...' });
        if (!fs.existsSync(paths.venvPath)) {
          await createVenv(python.path, paths.venvPath);
        }
        progress.report({ message: 'Installing packages...' });
        await pipInstall(paths.venvPath, paths.requirementsPath);
      });

      await this.context.globalState.update(STATE_VENV_READY, true);
      await this.context.globalState.update(STATE_PACKAGES_VERSION, CURRENT_PACKAGES_VERSION);
    }

    // Step 3: spawn worker (if not already)
    if (!this.bridge || !this.bridge.available) {
      this.bridge = new PythonBridge(paths.pythonPath, paths.workerPath);
      await this.bridge.spawn();
      this.initialized = false;
    }

    // Step 4: configure + warm load (one-time per session)
    if (!this.initialized) {
      await this.bridge.call('configure', { api_key: this.apiKey });
      const embeddings = await this.memoryStore.loadAllEmbeddings();
      const rows = embeddings.map((e) => [e.id, this.vectorToBase64(e.embedding)]);
      await this.bridge.call('warm_load', { rows });
      this.initialized = true;
    }

    // Step 5: backfill NULL embeddings
    const nullCount = await this.memoryStore.countNullEmbeddings();
    if (nullCount > 0) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `DevNote: indexing ${nullCount} past notes for search`,
        cancellable: false,
      }, async (progress) => {
        await this.backfillAll(progress);
      });
    }
  }

  /**
   * Embed a newly-synced note and append to the in-memory matrix.
   * Best-effort: if the bridge isn't ready, return silently — backfill catches later.
   */
  async embedNote(id: string, contentMarkdown: string): Promise<boolean> {
    if (!this.bridge || !this.bridge.available || !this.initialized) {
      return false;
    }
    try {
      const resp = await this.bridge.call('embed_and_append', {
        id,
        text: contentMarkdown,
      }) as { embedding: number[]; model: string };
      await this.memoryStore.updateEmbedding(id, resp.embedding, resp.model);
      return true;
    } catch (err) {
      console.error('[SearchService] embedNote failed:', err);
      return false;
    }
  }

  /**
   * Run a semantic search. Assumes ensureReady() has been called.
   * Returns top-k results above the threshold.
   */
  async searchQuery(query: string, k: number = SEARCH_K): Promise<RankedResult[]> {
    if (!this.bridge || !this.bridge.available || !this.initialized) {
      throw new Error('SearchService not ready. Call ensureReady() first.');
    }
    const resp = await this.bridge.call('search', {
      query,
      k,
      threshold: SEARCH_THRESHOLD,
    }) as { results: Array<{ id: string; score: number }> };
    return resp.results;
  }

  /**
   * Batch embed all NULL-embedding notes. Called by ensureReady() when needed.
   */
  private async backfillAll(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    if (!this.bridge || !this.bridge.available) {
      throw new Error('Bridge not ready for backfill');
    }

    const toEmbed = await this.memoryStore.getNotesWithNullEmbedding();
    if (toEmbed.length === 0) return;

    let done = 0;
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      progress.report({ message: `Embedding ${done + 1}-${done + batch.length} of ${toEmbed.length}` });

      try {
        const resp = await this.bridge.call('batch_embed', {
          texts: batch.map((n) => n.contentMarkdown),
        }) as { embeddings: number[][]; model: string };

        // Persist each vector to SQLite. Matrix refresh happens once at end.
        for (let j = 0; j < batch.length; j++) {
          await this.memoryStore.updateEmbedding(batch[j].id, resp.embeddings[j], resp.model);
        }
        done += batch.length;
      } catch (err) {
        console.error(`[SearchService] batch ${i / BATCH_SIZE} failed:`, err);
        // Continue with next batch — partial success persists
      }
    }

    // After all batches, reload matrix with full set (includes newly-embedded + pre-existing)
    const all = await this.memoryStore.loadAllEmbeddings();
    const rows = all.map((e) => [e.id, this.vectorToBase64(e.embedding)]);
    await this.bridge.call('warm_load', { rows });
  }

  /**
   * Reset the venv (Settings → Reset Python environment).
   */
  async resetEnvironment(): Promise<void> {
    await this.shutdown();
    const paths = getVenvPaths(this.context);
    deleteVenv(paths.venvPath);
    await this.context.globalState.update(STATE_VENV_READY, false);
    await this.context.globalState.update(STATE_PACKAGES_VERSION, undefined);
    this.initialized = false;
  }

  /**
   * Clear all embeddings (Settings → Re-index all notes).
   */
  async reindexAll(): Promise<void> {
    await this.memoryStore.clearAllEmbeddings();
    this.initialized = false;  // force full re-init + backfill on next ensureReady
    if (this.bridge && this.bridge.available) {
      try {
        await this.bridge.call('warm_load', { rows: [] });
      } catch (err) {
        console.error('[SearchService] reindexAll warm_load failed:', err);
        // initialized=false already ensures next ensureReady rebuilds state
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.bridge) {
      await this.bridge.shutdown();
      this.bridge = null;
    }
    this.initialized = false;
  }

  private vectorToBase64(vec: number[]): string {
    const arr = new Float32Array(vec);
    return Buffer.from(arr.buffer).toString('base64');
  }
}
