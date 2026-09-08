"use strict";

// Every `fs` function that takes a path, given a Buffer.
//
// **Node accepts a Buffer wherever it accepts a string path, and none of node's
// 260 `fs` test files passes one.** That is not an upstream oversight: on node
// the path is bytes in C++ from end to end and only becomes a string at the
// boundary, so there is no separate byte code path that could be wrong. Here
// there is: `getValidatedBytePath` and a `_bytes` binding per operation, which
// is different code from the string route with different bugs.
//
// **When this file was written, thirteen of the fourteen rejected a Buffer**
// outright with `ERR_INVALID_ARG_TYPE` -- unlink, mkdir, rmdir, chmod, chown,
// utimes, lutimes, rename, copyFile, link, readlink, rm and cp. Only
// `truncateSync` worked, and only because it delegates to `openSync`, which was
// already byte-aware. Nothing in node's suite could have found that.
//
// Thirteen are fixed and asserted below. The fourteenth, `cpSync`, is not, and
// it is *absent* rather than asserted: its implementation is an eight-function
// family -- `copyCpEntrySync`, `checkCpPathsSync`, `ensureCpParentSync`,
// `cpStatSync`, `onCpDirectorySync`, `onCpFileSync`, `onCpLinkSync`,
// `synchronousFilterAllows` -- all typed on `string`, and it carries a design
// question this file is not the place to answer: node hands the user's `filter`
// callback strings, so a byte-path `cp` has to decide what the filter sees.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nts-byte-family-"));
const B = (p) => Buffer.from(p);
const f = path.join(dir, "f");
const g = path.join(dir, "g");
const d2 = path.join(dir, "d2");

try {
  fs.writeFileSync(f, "hello");

  fs.writeFileSync(g, "x");
  fs.unlinkSync(B(g));
  assert.strictEqual(fs.existsSync(g), false, "unlinkSync accepts a Buffer");

  fs.mkdirSync(B(d2));
  assert.strictEqual(fs.statSync(d2).isDirectory(), true, "mkdirSync accepts a Buffer");
  fs.rmdirSync(B(d2));
  assert.strictEqual(fs.existsSync(d2), false, "rmdirSync accepts a Buffer");

  // Recursive mkdir walks components; on a byte path it must split on the byte
  // 0x2f rather than on a string, and it answers the first created path as a
  // string even for Buffer input -- which is node's behaviour, read off node.
  const deep = path.join(dir, "a", "b", "c");
  const created = fs.mkdirSync(B(deep), { recursive: true });
  assert.strictEqual(created, path.join(dir, "a"), "recursive mkdir answers the first created path");
  assert.strictEqual(fs.statSync(deep).isDirectory(), true, "recursive mkdir made the leaf");
  fs.rmSync(B(path.join(dir, "a")), { recursive: true });
  assert.strictEqual(fs.existsSync(path.join(dir, "a")), false, "rmSync accepts a Buffer");

  fs.chmodSync(B(f), 0o640);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o640, "chmodSync accepts a Buffer");
  fs.chownSync(B(f), -1, -1);
  fs.truncateSync(B(f), 5);
  assert.strictEqual(fs.statSync(f).size, 5, "truncateSync accepts a Buffer");
  fs.utimesSync(B(f), 1000, 2000);
  assert.strictEqual(Math.round(fs.statSync(f).mtimeMs / 1000), 2000, "utimesSync accepts a Buffer");

  fs.writeFileSync(g, "x");
  fs.renameSync(B(g), B(`${g}2`));
  assert.strictEqual(fs.existsSync(`${g}2`), true, "renameSync accepts Buffers");
  fs.unlinkSync(`${g}2`);

  fs.copyFileSync(B(f), B(g));
  assert.strictEqual(fs.readFileSync(g, "utf8"), fs.readFileSync(f, "utf8"), "copyFileSync accepts Buffers");
  fs.unlinkSync(g);

  fs.linkSync(B(f), B(g));
  assert.strictEqual(fs.statSync(g).ino, fs.statSync(f).ino, "linkSync accepts Buffers");
  fs.unlinkSync(g);

  fs.symlinkSync("f", g);
  assert.strictEqual(fs.readlinkSync(B(g)), "f", "readlinkSync accepts a Buffer");
  // And answers bytes when asked, which is the half a string return cannot do.
  assert.strictEqual(
    Buffer.isBuffer(fs.readlinkSync(B(g), { encoding: "buffer" })),
    true,
    "readlinkSync on a Buffer path can answer a Buffer",
  );
  fs.lutimesSync(B(g), 1000, 3000);
  assert.strictEqual(Math.round(fs.lstatSync(g).mtimeMs / 1000), 3000, "lutimesSync accepts a Buffer");
  fs.unlinkSync(g);

  // `cpSync` is deliberately absent. It still rejects a Buffer here and accepts
  // one on node, and the first draft of this file *asserted that it throws* --
  // which pins the defect as expected behaviour and makes the test fail against
  // the oracle it is supposed to be checking against. A test may assert what
  // node does; it may not assert what this implementation happens to do. The gap
  // is recorded in docs/conformance/nodejs.md instead, where gaps belong.
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
