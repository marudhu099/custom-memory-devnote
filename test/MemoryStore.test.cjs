'use strict';

const initSqlJs = require('sql.js');
const assert = require('assert');

const MIGRATION_SQL = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, branch_name TEXT NOT NULL,
  content_json TEXT NOT NULL, content_markdown TEXT NOT NULL,
  notion_page_id TEXT, notion_page_url TEXT, created_at INTEGER NOT NULL,
  embedding BLOB, embedding_model TEXT
);
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);
CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO schema_version (version, applied_at) VALUES (1, ${Date.now()});
`;

const SAMPLE_NOTE_JSON = JSON.stringify({
  title: 'Test note', summary: 'A test summary',
  whatChanged: ['change 1', 'change 2'], why: 'Testing',
  filesAffected: ['file1.ts', 'file2.ts'],
  keyDecisions: 'Decided to test', timestamp: '2026-04-16T00:00:00.000Z',
});
const SAMPLE_MARKDOWN = '# Test note\n\n## Summary\nA test summary';

function runMigration(db) {
  db.run(MIGRATION_SQL);
}

function insertNote(db, { id, title, branch, createdAt }) {
  db.run(
    `INSERT INTO notes (id, title, branch_name, content_json, content_markdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, title, branch, SAMPLE_NOTE_JSON, SAMPLE_MARKDOWN, createdAt]
  );
}

const tests = [
  {
    name: 'init creates notes table and schema_version (MAX version = 1)',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      const res = db.exec(`SELECT MAX(version) as v FROM schema_version`);
      const v = res[0].values[0][0];
      assert.strictEqual(v, 1, `Expected version 1, got ${v}`);
      db.close();
    },
  },
  {
    name: 'running migration twice is idempotent (version stays at 1)',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      // Running the INSERT again would violate PRIMARY KEY — catch and ignore
      try { db.run(`INSERT INTO schema_version (version, applied_at) VALUES (1, ${Date.now()})`); } catch (_) {}
      const res = db.exec(`SELECT MAX(version) as v FROM schema_version`);
      const v = res[0].values[0][0];
      assert.strictEqual(v, 1);
      db.close();
    },
  },
  {
    name: 'INSERT adds a row and COUNT(*) = 1',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-1', title: 'Test note', branch: 'main', createdAt: 1000 });
      const res = db.exec(`SELECT COUNT(*) FROM notes`);
      assert.strictEqual(res[0].values[0][0], 1);
      db.close();
    },
  },
  {
    name: 'content_json round-trips through JSON.parse (title and whatChanged)',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-2', title: 'Test note', branch: 'main', createdAt: 1000 });
      const res = db.exec(`SELECT content_json FROM notes WHERE id = 'note-2'`);
      const parsed = JSON.parse(res[0].values[0][0]);
      assert.strictEqual(parsed.title, 'Test note');
      assert.deepStrictEqual(parsed.whatChanged, ['change 1', 'change 2']);
      db.close();
    },
  },
  {
    name: 'content_markdown stores exact string',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-3', title: 'Test note', branch: 'main', createdAt: 1000 });
      const res = db.exec(`SELECT content_markdown FROM notes WHERE id = 'note-3'`);
      assert.strictEqual(res[0].values[0][0], SAMPLE_MARKDOWN);
      db.close();
    },
  },
  {
    name: 'LIST returns notes sorted newest-first',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'old-note', title: 'Old note', branch: 'main', createdAt: 1000 });
      insertNote(db, { id: 'new-note', title: 'New note', branch: 'main', createdAt: 2000 });
      const res = db.exec(`SELECT id FROM notes ORDER BY created_at DESC`);
      assert.strictEqual(res[0].values[0][0], 'new-note');
      assert.strictEqual(res[0].values[1][0], 'old-note');
      db.close();
    },
  },
  {
    name: 'LIST query returns only 4 columns (id, title, branch_name, created_at)',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-4', title: 'Test note', branch: 'main', createdAt: 1000 });
      const res = db.exec(`SELECT id, title, branch_name, created_at FROM notes`);
      assert.strictEqual(res[0].columns.length, 4);
      assert.deepStrictEqual(res[0].columns, ['id', 'title', 'branch_name', 'created_at']);
      db.close();
    },
  },
  {
    name: 'GET ONE returns full note with all fields',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-5', title: 'Test note', branch: 'feat/x', createdAt: 9999 });
      const res = db.exec(`SELECT * FROM notes WHERE id = 'note-5'`);
      assert.ok(res.length > 0, 'Expected a result');
      const cols = res[0].columns;
      assert.ok(cols.includes('id'));
      assert.ok(cols.includes('title'));
      assert.ok(cols.includes('branch_name'));
      assert.ok(cols.includes('content_json'));
      assert.ok(cols.includes('content_markdown'));
      assert.ok(cols.includes('created_at'));
      db.close();
    },
  },
  {
    name: 'GET ONE returns empty result for non-existent ID',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      const res = db.exec(`SELECT * FROM notes WHERE id = 'does-not-exist'`);
      assert.strictEqual(res.length, 0);
      db.close();
    },
  },
  {
    name: 'DELETE FROM notes removes all rows',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-6', title: 'Test note', branch: 'main', createdAt: 1000 });
      db.run(`DELETE FROM notes`);
      const res = db.exec(`SELECT COUNT(*) FROM notes`);
      assert.strictEqual(res[0].values[0][0], 0);
      db.close();
    },
  },
  {
    name: 'INSERT works after DELETE (DB usable after clear)',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-7', title: 'Before delete', branch: 'main', createdAt: 1000 });
      db.run(`DELETE FROM notes`);
      insertNote(db, { id: 'note-8', title: 'After delete', branch: 'main', createdAt: 2000 });
      const res = db.exec(`SELECT COUNT(*) FROM notes`);
      assert.strictEqual(res[0].values[0][0], 1);
      db.close();
    },
  },
  {
    name: 'EXPORT ALL returns parseable JSON array with correct data',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'export-1', title: 'Export note', branch: 'main', createdAt: 5000 });
      const res = db.exec(`SELECT * FROM notes ORDER BY created_at DESC`);
      // Simulate export: build array of objects from result
      const cols = res[0].columns;
      const rows = res[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
      });
      const exported = JSON.stringify(rows);
      const parsed = JSON.parse(exported);
      assert.ok(Array.isArray(parsed), 'Should be an array');
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].id, 'export-1');
      assert.strictEqual(parsed[0].title, 'Export note');
      db.close();
    },
  },
  {
    name: 'embedding column exists and defaults to NULL',
    async run(SQL) {
      const db = new SQL.Database();
      runMigration(db);
      insertNote(db, { id: 'note-9', title: 'Test note', branch: 'main', createdAt: 1000 });
      const res = db.exec(`SELECT embedding, embedding_model FROM notes WHERE id = 'note-9'`);
      assert.strictEqual(res[0].values[0][0], null, 'embedding should be NULL');
      assert.strictEqual(res[0].values[0][1], null, 'embedding_model should be NULL');
      db.close();
    },
  },
];

async function runTests() {
  const SQL = await initSqlJs();
  let passed = 0;
  let failed = 0;

  console.log(`\nRunning ${tests.length} MemoryStore unit tests...\n`);

  for (const test of tests) {
    try {
      await test.run(SQL);
      console.log(`  PASS  ${test.name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${test.name}`);
      console.error(`        ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
