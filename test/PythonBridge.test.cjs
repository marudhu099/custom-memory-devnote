const path = require('path');
const assert = require('assert');
const Module = require('module');

// Stub the 'vscode' module — PythonBridge only uses it for user-facing
// warning/error popups, which are no-ops outside the extension host.
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

async function runTests() {
  const { PythonBridge } = require('../out/PythonBridge');

  const bridge = new PythonBridge(
    'python',  // Windows — assumes Python is on PATH
    path.join(__dirname, 'fixtures/mock_worker.py')
  );

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

  console.log('\nPythonBridge tests:\n');

  await bridge.spawn();
  assert.strictEqual(bridge.available, true, 'bridge should be available after spawn');

  await test('echo request-response roundtrip', async () => {
    const result = await bridge.call('echo', { text: 'hello' });
    assert.deepStrictEqual(result, { text: 'hello' });
  });

  await test('concurrent requests resolve independently', async () => {
    const [r1, r2, r3] = await Promise.all([
      bridge.call('echo', { n: 1 }),
      bridge.call('echo', { n: 2 }),
      bridge.call('echo', { n: 3 }),
    ]);
    assert.strictEqual(r1.n, 1);
    assert.strictEqual(r2.n, 2);
    assert.strictEqual(r3.n, 3);
  });

  await test('error response rejects the promise', async () => {
    try {
      await bridge.call('error', {});
      assert.fail('should have rejected');
    } catch (e) {
      assert.ok(e.message.includes('test error'));
    }
  });

  await test('unknown method returns error', async () => {
    try {
      await bridge.call('nonexistent', {});
      assert.fail('should have rejected');
    } catch (e) {
      assert.ok(e.message.includes('unknown method'));
    }
  });

  await bridge.shutdown();

  await test('call after shutdown rejects', async () => {
    try {
      await bridge.call('echo', {});
      assert.fail('should have rejected');
    } catch (e) {
      assert.ok(e.message.includes('not spawned'));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
