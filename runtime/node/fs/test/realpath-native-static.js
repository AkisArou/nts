// `fs.promises.realpath` is the **binding**, not the JavaScript walk that `realpathSync` uses.
//
// node ships two resolvers under one name. `fs.realpathSync` and `fs.realpath` walk the path in
// JavaScript with an `lstat` cache; `fs.realpathSync.native` and `fs.realpath.native` call
// `uv_fs_realpath`, and `fs.promises.realpath` calls the binding as well --
// `lib/internal/fs/promises.js` is `binding.realpath(getValidatedPath(path), ...)` with no walk.
//
// They disagree, and node ships the disagreement. A file path with a trailing slash:
//
//     fs.promises.realpath   ENOTDIR
//     fs.realpath            resolves
//     fs.realpathSync        resolves
//
// This profile promisified its own callback `realpath`, which made all three agree. That is the
// reasonable behaviour and the wrong one, and being self-consistent is exactly what hid it: every
// internal check agreed with every other.
//
// Found by `differential-ts.mjs` the first run after it could await a spec -- 719 of 4,024
// generated paths diverged here and nowhere else. Node's own suite does not reach it, because a
// trailing slash on a file through `fs.promises.realpath` is not a case anyone wrote down.
"use strict";

const common = require("../common");

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// A directory in the repository, and a file inside it. Read-only; nothing here writes.
const base = path.join(__dirname, "..", "..", "punycode");
const file = path.join(base, "shape.mjs");

assert.ok(fs.existsSync(file), "the fixture file is missing, so every case below would agree on ENOENT");

// **The completion is asserted, not just the steps.** An async body that throws part-way is an
// unhandled rejection: the process exits non-zero and the harness prints no result line, so the
// failure arrives as an exit code with no reason attached. Reaching the end is what this counts,
// so a sabotaged run reports which assertion failed instead of only that something did.
const finished = common.mustCall(() => {});

(async () => {
  // The divergence itself: a trailing slash on a file.
  await assert.rejects(
    () => fs.promises.realpath(`${file}/`),
    (error) => error.code === "ENOTDIR",
    "fs.promises.realpath must reject a trailing slash on a file, as node's binding does",
  );

  // And the walk resolves the same path, which is the half that must not change.
  assert.strictEqual(
    fs.realpathSync(`${file}/`),
    fs.realpathSync(file),
    "fs.realpathSync walks the path and resolves a trailing slash",
  );
  await new Promise((resolve, reject) => {
    fs.realpath(`${file}/`, (error, resolved) => {
      if (error) { reject(error); return; }
      assert.strictEqual(resolved, fs.realpathSync(file));
      resolve();
    });
  });

  // `.native` is the binding on both sides, so it agrees with the promises form.
  assert.throws(
    () => fs.realpathSync.native(`${file}/`),
    (error) => error.code === "ENOTDIR",
    "fs.realpathSync.native is the binding and must reject it",
  );

  // A path that does not exist is ENOENT everywhere, which is the control: if the base were
  // wrong, every case above would agree on ENOENT and this file would pass having compared
  // nothing.
  await assert.rejects(() => fs.promises.realpath(path.join(base, "nope")),
    (error) => error.code === "ENOENT");
  assert.throws(() => fs.realpathSync(path.join(base, "nope")),
    (error) => error.code === "ENOENT");

  // And a real directory resolves through every form.
  const resolved = fs.realpathSync(base);
  assert.strictEqual(await fs.promises.realpath(base), resolved);
  assert.strictEqual(fs.realpathSync.native(base), resolved);

  finished();
})();
