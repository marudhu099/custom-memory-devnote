import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { StructuredNote } from './LLMService';

// ── Exported row types ─────────────────────────────────────────────

export interface RecentNoteRow {
  id: string;
  title: string;
  branchName: string;
  createdAt: number;
}

export interface FullNote {
  id: string;
  title: string;
  branchName: string;
  content: StructuredNote;
  contentMarkdown: string;
  notionPageId: string | null;
  notionPageUrl: string | null;
  createdAt: number;
}

export interface NoteMetadata {
  title: string;
  branchName: string;
  notionPageId: string;
  notionPageUrl: string;
}

// ── Schema migrations ──────────────────────────────────────────────

interface Migration {
  version: number;
  sql: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE notes (
        id               TEXT PRIMARY KEY,
        title            TEXT NOT NULL,
        branch_name      TEXT NOT NULL,
        content_json     TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        notion_page_id   TEXT,
        notion_page_url  TEXT,
        created_at       INTEGER NOT NULL,
        embedding        BLOB,
        embedding_model  TEXT
      );`,
      `CREATE INDEX idx_notes_created_at ON notes(created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`,
    ],
  },
];

// ── MemoryStore ────────────────────────────────────────────────────

export class MemoryStore {
  private db: Database | null = null;
  private _available = false;
  private readonly dbPath: string;
  private readonly wasmPath: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    const globalDir = context.globalStorageUri.fsPath;
    this.dbPath = path.join(globalDir, 'devnote.db');
    this.wasmPath = path.join(
      context.extensionUri.fsPath,
      'node_modules',
      'sql.js',
      'dist',
      'sql-wasm.wasm',
    );
  }

  /** Whether the store initialised successfully and is ready for queries. */
  get available(): boolean {
    return this._available;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async init(): Promise<void> {
    try {
      const SQL = await initSqlJs({
        locateFile: () => this.wasmPath,
      });

      // Ensure the storage directory exists.
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open existing DB or create a fresh one.
      try {
        if (fs.existsSync(this.dbPath)) {
          const fileBuffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(fileBuffer);
          // Quick sanity check – try to read schema_version.
          try {
            this.db.exec('SELECT 1 FROM schema_version LIMIT 1');
          } catch {
            // Table missing – could be a fresh DB written by an older version.
            // Let migrations handle it.
          }
        } else {
          this.db = new SQL.Database();
        }
      } catch {
        // Corrupt DB – move aside and start fresh.
        const corruptName = `${this.dbPath}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.dbPath, corruptName);
        } catch {
          // Best-effort rename; ignore if it fails.
        }
        vscode.window.showWarningMessage(
          `DevNote: database was corrupt and has been reset. A backup was saved as ${path.basename(corruptName)}.`,
        );
        this.db = new SQL.Database();
      }

      await this.runMigrations();
      this.persist();
      this._available = true;
    } catch (err) {
      // WASM load failure or other fatal error – degrade gracefully.
      this._available = false;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DevNote] MemoryStore init failed:', message);
    }
  }

  // ── Public CRUD ────────────────────────────────────────────────

  async saveNote(note: StructuredNote, meta: NoteMetadata): Promise<string> {
    if (!this.db) {
      throw new Error('MemoryStore is not available');
    }

    const id = crypto.randomUUID();
    const contentJson = JSON.stringify(note);
    const contentMarkdown = this.serializeNoteToMarkdown(note);
    const createdAt = Date.now();

    this.db.run(
      `INSERT INTO notes (id, title, branch_name, content_json, content_markdown, notion_page_id, notion_page_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        meta.title,
        meta.branchName,
        contentJson,
        contentMarkdown,
        meta.notionPageId || null,
        meta.notionPageUrl || null,
        createdAt,
      ],
    );

    this.persist();
    return id;
  }

  async getRecentNotes(): Promise<RecentNoteRow[]> {
    if (!this.db || !this._available) {
      return [];
    }

    const result = this.db.exec(
      'SELECT id, title, branch_name, created_at FROM notes ORDER BY created_at DESC',
    );

    if (result.length === 0) {
      return [];
    }

    return result[0].values.map((row: SqlValue[]) => ({
      id: row[0] as string,
      title: row[1] as string,
      branchName: row[2] as string,
      createdAt: row[3] as number,
    }));
  }

  async getNoteById(id: string): Promise<FullNote | null> {
    if (!this.db || !this._available) {
      return null;
    }

    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    stmt.bind([id]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject();
    stmt.free();

    return {
      id: row['id'] as string,
      title: row['title'] as string,
      branchName: row['branch_name'] as string,
      content: JSON.parse(row['content_json'] as string) as StructuredNote,
      contentMarkdown: row['content_markdown'] as string,
      notionPageId: (row['notion_page_id'] as string) || null,
      notionPageUrl: (row['notion_page_url'] as string) || null,
      createdAt: row['created_at'] as number,
    };
  }

  async clearAll(): Promise<void> {
    if (!this.db) {
      return;
    }
    this.db.run('DELETE FROM notes');
    this.persist();
  }

  async exportAll(): Promise<string> {
    if (!this.db || !this._available) {
      return '[]';
    }

    const result = this.db.exec('SELECT * FROM notes ORDER BY created_at DESC');
    if (result.length === 0) {
      return '[]';
    }

    const columns = result[0].columns;
    const notes = result[0].values.map((row: SqlValue[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        if (col === 'content_json') {
          obj[col] = JSON.parse(row[i] as string);
        } else {
          obj[col] = row[i];
        }
      });
      return obj;
    });

    return JSON.stringify(notes, null, 2);
  }

  async updateEmbedding(id: string, embedding: number[], modelName: string): Promise<void> {
    if (!this.db) {
      throw new Error('MemoryStore is not available');
    }
    const arr = new Float32Array(embedding);
    const buf = Buffer.from(arr.buffer);

    this.db.run(
      `UPDATE notes SET embedding = ?, embedding_model = ? WHERE id = ?`,
      [buf, modelName, id]
    );
    this.persist();
  }

  async getNotesWithNullEmbedding(): Promise<Array<{ id: string; contentMarkdown: string }>> {
    if (!this.db || !this._available) {
      return [];
    }
    const result = this.db.exec(
      'SELECT id, content_markdown FROM notes WHERE embedding IS NULL'
    );
    if (result.length === 0) {
      return [];
    }
    return result[0].values.map((row) => ({
      id: row[0] as string,
      contentMarkdown: row[1] as string,
    }));
  }

  async loadAllEmbeddings(): Promise<Array<{ id: string; embedding: number[] }>> {
    if (!this.db || !this._available) {
      return [];
    }
    const result = this.db.exec(
      'SELECT id, embedding FROM notes WHERE embedding IS NOT NULL'
    );
    if (result.length === 0) {
      return [];
    }
    return result[0].values.map((row) => {
      const id = row[0] as string;
      const blob = row[1] as Uint8Array;
      const floatArray = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      return {
        id,
        embedding: Array.from(floatArray),
      };
    });
  }

  async countNullEmbeddings(): Promise<number> {
    if (!this.db || !this._available) {
      return 0;
    }
    const result = this.db.exec('SELECT COUNT(*) FROM notes WHERE embedding IS NULL');
    if (result.length === 0) {
      return 0;
    }
    return result[0].values[0][0] as number;
  }

  async clearAllEmbeddings(): Promise<void> {
    if (!this.db) {
      throw new Error('MemoryStore is not available');
    }
    this.db.run('UPDATE notes SET embedding = NULL, embedding_model = NULL');
    this.persist();
  }

  // ── Private helpers ────────────────────────────────────────────

  private serializeNoteToMarkdown(note: StructuredNote): string {
    return [
      `# ${note.title}`,
      ``,
      `## Summary`,
      note.summary,
      ``,
      `## What Changed`,
      ...note.whatChanged.map((c) => `- ${c}`),
      ``,
      `## Why`,
      note.why,
      ``,
      `## Key Decisions`,
      note.keyDecisions,
      ``,
      `## Files Affected`,
      ...note.filesAffected.map((f) => `- ${f}`),
    ].join('\n');
  }

  private persist(): void {
    if (!this.db) {
      return;
    }
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `DevNote: failed to persist database — ${message}`,
      );
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) {
      return;
    }

    // Ensure the schema_version table exists (handles very first run).
    this.db.run(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );

    // Determine current version.
    const result = this.db.exec('SELECT MAX(version) FROM schema_version');
    const currentVersion =
      result.length > 0 && result[0].values[0][0] !== null
        ? (result[0].values[0][0] as number)
        : 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        for (const sql of migration.sql) {
          this.db.run(sql);
        }
        this.db.run(
          'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
          [migration.version, Date.now()],
        );
      }
    }
  }
}
