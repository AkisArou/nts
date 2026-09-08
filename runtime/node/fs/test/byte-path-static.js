"use strict";

// Paths that are not valid UTF-8, which the `_bytes` binding family exists for.
//
// **Three of node's two hundred and sixty `fs` test files use
// `encoding: 'buffer'` at all**, and none of them builds a filename out of bytes
// that cannot be decoded. That is not an upstream oversight: on node the whole
// path is handled as bytes in C++ and only converted at the boundary, so a
// filename that does not decode cannot go wrong anywhere a JavaScript test could
// look. Here it crosses a TypeScript module built on a *separate* set of
// bindings -- `nts_fs_scandir_bytes`, `nts_fs_opendir_bytes`,
// `nts_fs_stat_bytes`, `nts_fs_realpath_bytes`, `nts_fs_access_bytes` -- and the
// byte path and the string path are different code with different bugs.
//
// The name used is `61 ff fe 62`: an `a`, a lone `0xff` and a lone `0xfe`
// (neither is legal anywhere in UTF-8), and a `b`. Every assertion below was
// read off node v24.20.0 before it was written down.
//
// The important one is that the *string* form does **not** round-trip. A
// implementation that quietly decoded and re-encoded would pass a test that only
// checked `readdir` returned one entry, and would then fail to open the file it
// had just listed.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nts-byte-path-"));
const raw = Buffer.from([0x61, 0xff, 0xfe, 0x62]);
const bytePath = Buffer.concat([Buffer.from(`${dir}/`), raw]);

try {
  fs.writeFileSync(bytePath, "x");

  // readdir, as bytes, returns exactly what was written.
  const asBuffers = fs.readdirSync(dir, { encoding: "buffer" });
  assert.strictEqual(asBuffers.length, 1);
  assert.strictEqual(Buffer.isBuffer(asBuffers[0]), true, "buffer encoding gives a Buffer");
  assert.strictEqual(asBuffers[0].equals(raw), true, "readdir bytes are the bytes on disk");

  // readdir, as a string, is lossy -- and has to be, since those bytes have no
  // UTF-8 meaning. Pinning the lossiness is the point: it is what stops an
  // implementation from "helpfully" round-tripping through a string.
  const asString = fs.readdirSync(dir)[0];
  assert.strictEqual(typeof asString, "string");
  assert.strictEqual(
    Buffer.from(asString, "utf8").equals(raw),
    false,
    "the string form must NOT round-trip back to the original bytes",
  );

  // opendir carries the same bytes through a handle rather than a single call.
  const handle = fs.opendirSync(dir, { encoding: "buffer" });
  const entry = handle.readSync();
  assert.strictEqual(Buffer.isBuffer(entry.name), true, "opendir buffer encoding gives a Buffer");
  assert.strictEqual(entry.name.equals(raw), true, "opendir bytes are the bytes on disk");
  assert.strictEqual(handle.readSync(), null, "one entry, then done");
  handle.closeSync();

  // The byte path is usable, not merely readable.
  assert.strictEqual(fs.statSync(bytePath).size, 1, "stat by byte path");
  assert.strictEqual(fs.lstatSync(bytePath).size, 1, "lstat by byte path");
  assert.strictEqual(fs.readFileSync(bytePath, "utf8"), "x", "read by byte path");
  fs.accessSync(bytePath, fs.constants.F_OK);

  // And the string form is not, which is the other half of "does not round-trip".
  assert.throws(
    () => fs.statSync(path.join(dir, asString)),
    { code: "ENOENT" },
    "the lossy string names no file",
  );

  fs.unlinkSync(bytePath);
  assert.strictEqual(fs.readdirSync(dir).length, 0, "unlink by byte path removed it");
} finally {
  // Cleanup must not be able to replace the failure it is cleaning up after.
  // The first version let an `ENOTEMPTY` from `rmdir` surface instead of the
  // assertion that had actually thrown, which reported a tidy-up problem and
  // hid the finding.
  try {
    for (const name of fs.readdirSync(dir, { encoding: "buffer" })) {
      fs.unlinkSync(Buffer.concat([Buffer.from(`${dir}/`), name]));
    }
    fs.rmdirSync(dir);
  } catch {}
}
