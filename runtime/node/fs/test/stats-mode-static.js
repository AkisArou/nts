// `Stats` decodes the mode bits, which is the one thing the compiled `fs`
// computes that a test can reach.
//
// The compiled `fs` publishes two of node's names -- `Stats` and `constants` --
// out of a module with 394 upstream test files, every one of which needs a
// filesystem. Its single pass is `local/constants-static.js`, a table
// comparison that survives `--mutate-addon`, so `fs` has been on the axis
// without demonstrating anything it computes.
//
// `Stats` is a computation: `S_IFMT` masking, one field turned into six
// predicates. It needs no filesystem, because the constructor takes the columns
// directly.
//
//     0o040755 -> isDirectory()     0o100644 -> isFile()
//     0o120777 -> isSymbolicLink()  0o020666 -> isCharacterDevice()
//     0o060000 -> isBlockDevice()   0o010666 -> isFIFO()
//     0o140666 -> isSocket()
//
// # Why all seven and not one
//
// One mode is satisfied by a predicate that answers `true` for everything, and
// its negation by one that answers `false`. Seven modes, each asserting its own
// predicate true and the other six false, is 49 answers from one field -- and a
// mask off by a bit gets several of them wrong.
//
// # The constructor is node's, through an adapter
//
// The compiled `Stats` takes an **array** of columns; node's takes them
// positionally. `fs/shape.mjs`'s `callableStats` collects `...columns` and
// forwards the array, so this file uses node's spelling. That adapter is part
// of what is under test here -- calling the raw addon directly would not
// exercise it.
//
// Node deprecated this constructor in DEP0180 and the shim emits the warning,
// which is why the file installs a handler rather than letting it print.
//
// # The fields, which this file could not assert when it was written
//
// It shipped saying "`mode` itself reads `undefined` on the instance -- the
// field is not published, only the predicates that read it." That was the whole
// of `blockers/class-fields-do-not-cross`, and it is fixed: the fourteen
// columns come back as **own enumerable properties**, in node's order, and
// `JSON.stringify` round-trips them.
//
// So the columns are asserted here now, and they are asserted as *own*
// properties rather than by reading them. `napi_define_class` puts descriptors
// on the prototype, and the first version of the fix did exactly that -- every
// field read correctly while `Object.keys` was `[]`. Reading `stats.size` would
// have passed on that object; `Object.hasOwn(stats, "size")` does not.
//
// The values are the constructor's own columns rather than a real file's, so
// this stays a test of the crossing and not of the filesystem.
"use strict";

require("../common");

const assert = require("assert");
const fs = require("fs");

process.on("warning", (w) => {
  if (w.code !== "DEP0180") throw w;
});

assert.strictEqual(typeof fs.Stats, "function", "fs.Stats is missing");

const KINDS = [
  ["isDirectory", 0o040755],
  ["isFile", 0o100644],
  ["isSymbolicLink", 0o120777],
  ["isCharacterDevice", 0o020666],
  ["isBlockDevice", 0o060000],
  ["isFIFO", 0o010666],
  ["isSocket", 0o140666],
];

// The columns come back as own properties, in node's order.
const COLUMNS = [
  "dev", "mode", "nlink", "uid", "gid", "rdev", "blksize", "ino",
  "size", "blocks", "atimeMs", "mtimeMs", "ctimeMs", "birthtimeMs",
];
const VALUES = [7, 0o100644, 1, 2, 3, 0, 4096, 99, 123, 8, 11, 12, 13, 14];
const carried = new fs.Stats(...VALUES);

// The fourteen are present and in node's relative order. **Not an exact key
// list**, and the reason is a lane difference this file should not assert away:
//
//     node          14 own keys, growing as its Date getters are first read
//     interpreted    18 -- `stats.ts` assigns the four Dates in the constructor
//     compiled       14 -- a `Date` is a reference and cannot cross outward
//
// Asserting exactly fourteen passed compiled and failed interpreted, which is
// the direction `prize.mjs` calls INVERTED: right answer, wrong reason. Node's
// own `test-fs-stat-date.mjs` asserts only that `Object.keys` *includes*
// `atime` and `mtime`, after reading them -- so the eager assignment is the
// closer approximation of what node's suite observes, and a plain getter that
// never materialises the property fails three of node's tests. Measured, by
// making the change and running them.
const keys = Object.keys(carried);
for (const column of COLUMNS) {
  assert.ok(keys.includes(column), `${column} is not an own enumerable property`);
}
const positions = COLUMNS.map((c) => keys.indexOf(c));
assert.deepStrictEqual(
  positions,
  [...positions].sort((a, b) => a - b),
  "the fourteen columns are not in node's relative order",
);

for (let i = 0; i < COLUMNS.length; i++) {
  assert.ok(
    Object.hasOwn(carried, COLUMNS[i]),
    `${COLUMNS[i]} is not an own property -- a prototype accessor reads the same`,
  );
  assert.strictEqual(
    carried[COLUMNS[i]],
    VALUES[i],
    `${COLUMNS[i]} did not come back as it was constructed`,
  );
}

// And they survive being serialised, which a prototype accessor does not.
const round = JSON.parse(JSON.stringify(carried));
assert.strictEqual(round.size, 123, "size did not survive JSON.stringify");
assert.strictEqual(round.ino, 99, "ino did not survive JSON.stringify");

for (const [kind, mode] of KINDS) {
  // Node's positional order: dev, mode, nlink, uid, gid, rdev, blksize, ino,
  // size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs.
  const stats = new fs.Stats(0, mode, 1, 0, 0, 0, 4096, 1, 0, 8, 0, 0, 0, 0);

  for (const [other] of KINDS) {
    const answer = stats[other]();
    assert.strictEqual(
      typeof answer,
      "boolean",
      `${other}() did not return a boolean for mode 0o${mode.toString(8)}`,
    );
    assert.strictEqual(
      answer,
      other === kind,
      `${other}() is ${answer} for mode 0o${mode.toString(8)}, which is ${kind}`,
    );
  }
}
