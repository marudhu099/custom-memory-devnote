const path = require('path');
const assert = require('assert');
const Module = require('module');

// Stub the 'vscode' module — ChatService doesn't use vscode directly, but
// transitive imports (MemoryStore types) might. Mirror PythonBridge.test.cjs.
const vscodeStub = {
  window: {
    showWarningMessage: () => {},
    showErrorMessage: () => {},
    showInformationMessage: () => {},
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vscode') return 'vscode';
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

const { ChatService } = require('../out/ChatService');

// === helpers ===

function sampleNotes(n) {
  // Returns [strongest, ..., weakest] — caller controls strength via input order.
  // buildPrompt only reads { title, contentMarkdown, createdAt }, so the rest of
  // FullNote is filled with shape-compatible placeholders.
  return Array.from({ length: n }, (_, i) => ({
    id: `note-${i + 1}`,
    title: `Note ${i + 1} title`,
    branchName: 'main',
    contentMarkdown: `Body of note ${i + 1}`,
    content: {
      title: `Note ${i + 1} title`,
      summary: '',
      whatChanged: [],
      why: '',
      keyDecisions: '',
      filesAffected: [],
    },
    notionPageId: null,
    notionPageUrl: null,
    createdAt: 1714060800000 + i * 86400000, // Apr 25, 26, 27 ...
  }));
}

function makeService() {
  // Mock SearchService — only searchQuery + ensureReady are called by ChatService
  const searchService = {
    ensureReady: async () => {},
    searchQuery: async (_q, _k) => [],
  };
  // Mock MemoryStore — only getNotesByIds is called by ChatService
  const memoryStore = {
    getNotesByIds: async (_ids) => [],
  };
  // Mock PythonBridge — only callStream is called by ChatService
  const bridge = {
    callStream: async (_method, _params, _onChunk) => ({ final: '', model: 'mock' }),
  };
  return new ChatService(searchService, memoryStore, bridge);
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failed++;
    }
  }

  console.log('\nChatService tests:\n');

  await test('buildPrompt contains all 7 critical rules', async () => {
    const svc = makeService();
    const prompt = svc['buildPrompt']('q', sampleNotes(3));
    for (let i = 1; i <= 7; i++) {
      assert.match(prompt, new RegExp(`^${i}\\.`, 'm'), `rule ${i} missing from prompt`);
    }
  });

  await test('buildPrompt orders notes weakest-first (Note 1 last in body)', async () => {
    const svc = makeService();
    const notes = sampleNotes(3); // [strongest=Note 1, mid=Note 2, weakest=Note 3]
    const prompt = svc['buildPrompt']('q', notes);
    const idxNote1 = prompt.indexOf('--- Note 1 ---');
    const idxNote3 = prompt.indexOf('--- Note 3 ---');
    assert.ok(idxNote3 < idxNote1, 'weakest (Note 3) should appear before strongest (Note 1) in prompt body');
  });

  await test('history block omitted on first turn', async () => {
    const svc = makeService();
    const prompt = svc['buildPrompt']('first turn', sampleNotes(2));
    assert.ok(!prompt.includes('Conversation so far:'), 'no history section expected on first turn');
  });

  await test('history block present from turn 2, capped at last 4 turns', async () => {
    const svc = makeService();
    // Inject 6 prior turns directly via the private field (bracket-access)
    svc['history'] = [
      { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'q2' }, { role: 'assistant', text: 'a2' },
      { role: 'user', text: 'q3' }, { role: 'assistant', text: 'a3' },
    ];
    const prompt = svc['buildPrompt']('q4', sampleNotes(2));
    const block = prompt.split('Conversation so far:')[1];
    assert.ok(block, 'history block expected from turn 2 onwards');
    assert.ok(!block.includes('q1'), 'q1 should be dropped (outside last 4 entries)');
    assert.ok(!block.includes('a1'), 'a1 should be dropped (outside last 4 entries)');
    assert.ok(block.includes('q2'), 'q2 should be kept (within last 4 entries)');
    assert.ok(block.includes('q3'), 'q3 should be kept (within last 4 entries)');
    assert.ok(block.includes('a3'), 'a3 should be kept (within last 4 entries)');
  });

  await test('clearHistory resets history', async () => {
    const svc = makeService();
    svc['history'] = [{ role: 'user', text: 'q1' }];
    svc.clearHistory();
    assert.deepStrictEqual(svc.getHistory(), []);
  });

  await test('extractCitations strips invalid Note numbers', async () => {
    const svc = makeService();
    const notes = sampleNotes(3);
    const text = 'See [Note 1], [Note 2], and [Note 7].';
    const refs = svc['extractCitations'](text, notes);
    assert.strictEqual(refs.length, 2, 'only 2 valid citations should remain (Note 7 invalid for k=3)');
    assert.deepStrictEqual(refs.map((r) => r.noteNumber), [1, 2]);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
