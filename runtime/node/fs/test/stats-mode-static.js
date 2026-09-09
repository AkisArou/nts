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
// `mode` itself reads `undefined` on the instance -- the field is not published,
// only the predicates that read it. Not asserted here; a separate gap.
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
