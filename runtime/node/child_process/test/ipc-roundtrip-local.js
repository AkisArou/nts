'use strict';
// The simplest thing fork has to do: carry a message each way.
//
// Written before touching any of the 25 fork/IPC failures, because every one of them
// assumes this works and none of them says whether it does.
//
// **The child branch comes first and requires nothing.** A forked child is a plain
// `node <file>` with no substitution, so `require('../common')` resolves against this
// directory rather than node's test tree and is simply absent. The sibling
// `package.json` declaring `"type": "commonjs"` is what makes both the `require` in
// the parent half and this top-level `return` legal at all: the repo root declares
// `"type": "module"`, and under that a forked child reads this file as ESM.
if (process.argv[2] === 'child') {
  process.on('message', (m) => {
    process.send({ echo: m.ping });
  });
  return;
}

const common = require('../common');
const assert = require('assert');
const cp = require('child_process');

const child = cp.fork(__filename, ['child']);
child.on('message', common.mustCall((m) => {
  assert.deepStrictEqual(m, { echo: 7 });
  child.disconnect();
}));
child.send({ ping: 7 });
child.on('exit', common.mustCall((code) => {
  assert.strictEqual(code, 0);
}));
