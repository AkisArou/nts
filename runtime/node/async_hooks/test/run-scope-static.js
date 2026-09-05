// Supported, statically named subset of node v24.20.0
// `test/parallel/test-async-local-storage-run-scope.js`. The upstream file
// mostly invokes `Symbol.dispose` through `using`, a §13 non-goal; these cases
// retain its ordinary `withScope()` / `dispose()` behavior as an oracle.
'use strict';

const assert = require('assert');
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage({ defaultValue: 'default' });
assert.strictEqual(storage.getStore(), 'default');

const outer = storage.withScope('outer');
assert.strictEqual(storage.getStore(), 'outer');

const inner = storage.withScope('inner');
assert.strictEqual(storage.getStore(), 'inner');
inner.dispose();
assert.strictEqual(storage.getStore(), 'outer');

outer.dispose();
assert.strictEqual(storage.getStore(), 'default');

storage.enterWith('later');
outer.dispose();
assert.strictEqual(storage.getStore(), 'later');

// The pinned implementation uses ReflectApply with null for both callback
// forms. Keep that observable receiver without bringing Reflect into the
// Native TypeScript source.
storage.run('run receiver', function() {
  assert.strictEqual(this, null);
});
storage.exit(function() {
  assert.strictEqual(this, null);
});
