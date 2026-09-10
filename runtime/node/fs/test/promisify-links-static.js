"use strict";

// The two `fs` entry points whose shape `util.promisify` cannot guess.
//
// `fs.exists` takes a `(exists)` callback rather than a node-style
// `(err, exists)`, so the generic wrapper reads the boolean as an error: a path
// that exists rejects, and one that does not resolves with undefined. Exactly
// backwards, and quietly.
//
// `fs.promises.opendir` carries a **self-link** on node -- `opendir[custom] ===
// opendir` -- because it already returns a promise and promisify must hand it
// back rather than wrap it.
//
// Neither can be missing on node, where both are set beside the definition, so
// node's suite has no reason to assert either.

require("../common");
const assert = require("assert");
const fs = require("fs");
const fsPromises = require("fs/promises");
const { promisify } = require("util");

const custom = Symbol.for("nodejs.util.promisify.custom");

assert.strictEqual(typeof fs.exists[custom], "function");
assert.strictEqual(fsPromises.opendir[custom], fsPromises.opendir);

const exists = promisify(fs.exists);
exists(__filename).then((answer) => {
  assert.strictEqual(answer, true, "an existing path must resolve true, not reject");
});
exists(`${__filename}.does-not-exist`).then((answer) => {
  assert.strictEqual(answer, false, "a missing path must resolve false, not undefined");
});
