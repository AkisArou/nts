"use strict";

// The shape of every `fs` error: constructor, code, errno, syscall, path, dest,
// message, and which keys are its own.
//
// Node builds these in one C++ helper, so upstream the fields cannot disagree
// with each other and there is nothing a test could catch. Here every call site
// passes its own arguments to `uvException`, and the ones this file found were
// all in that passing.
//
// **Node's synchronous `opendir` error carries no path at all** -- not in the
// message, not as a property; its own keys are exactly `code`, `errno`,
// `syscall`. Its *asynchronous* and *promises* forms do carry it, on the same
// failure, for the same directory. That asymmetry is node's, nothing in its
// suite pins it, and it is matched rather than improved: a path there would be
// more useful and would be a divergence.
//
// The own-key set is the other half. `path`, `dest` and `filename` were declared
// as optional class fields, and under `useDefineForClassFields` a declaration is
// emitted as an own property whether or not it holds anything -- so every
// single-path error carried `dest` and `filename` in `Object.keys`, visible
// through spread, `JSON.stringify` and `util.inspect`. They are attached at the
// call site now.
//
// One row is deliberately absent: `Object.getPrototypeOf(err) ===
// Error.prototype` is `true` on node and `false` here, because node's really is
// an `Error` and this is a subclass. It is **not asserted**, because asserting
// it would pin a divergence nobody chose -- see the rule in
// `runtime/node/buffer/test/input-forms-static.js`. `err.constructor` and
// `err.constructor.name` do match, through the same override the `ERR_*` classes
// use.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SHAPES = [
  ["statSync", "Error|ENOENT|-2|stat|<dir>/absent|undefined|ENOENT: no such file or directory, stat '<dir>/absent'"],
  ["lstatSync", "Error|ENOENT|-2|lstat|<dir>/absent|undefined|ENOENT: no such file or directory, lstat '<dir>/absent'"],
  ["readFileSync", "Error|ENOENT|-2|open|<dir>/absent|undefined|ENOENT: no such file or directory, open '<dir>/absent'"],
  ["openSync", "Error|ENOENT|-2|open|<dir>/absent|undefined|ENOENT: no such file or directory, open '<dir>/absent'"],
  ["unlinkSync", "Error|ENOENT|-2|unlink|<dir>/absent|undefined|ENOENT: no such file or directory, unlink '<dir>/absent'"],
  ["rmdirSync", "Error|ENOENT|-2|rmdir|<dir>/absent|undefined|ENOENT: no such file or directory, rmdir '<dir>/absent'"],
  ["chmodSync", "Error|ENOENT|-2|chmod|<dir>/absent|undefined|ENOENT: no such file or directory, chmod '<dir>/absent'"],
  ["chownSync", "Error|ENOENT|-2|chown|<dir>/absent|undefined|ENOENT: no such file or directory, chown '<dir>/absent'"],
  ["utimesSync", "Error|ENOENT|-2|utime|<dir>/absent|undefined|ENOENT: no such file or directory, utime '<dir>/absent'"],
  ["readlinkSync", "Error|ENOENT|-2|readlink|<dir>/absent|undefined|ENOENT: no such file or directory, readlink '<dir>/absent'"],
  ["realpathSync", "Error|ENOENT|-2|lstat|<dir>/absent|undefined|ENOENT: no such file or directory, lstat '<dir>/absent'"],
  ["accessSync", "Error|ENOENT|-2|access|<dir>/absent|undefined|ENOENT: no such file or directory, access '<dir>/absent'"],
  ["readdirSync", "Error|ENOENT|-2|scandir|<dir>/absent|undefined|ENOENT: no such file or directory, scandir '<dir>/absent'"],
  ["opendirSync", "Error|ENOENT|-2|opendir|undefined|undefined|ENOENT: no such file or directory, opendir"],
  ["renameSync", "Error|ENOENT|-2|rename|<dir>/absent|<dir>/b|ENOENT: no such file or directory, rename '<dir>/absent' -> '<dir>/b'"],
  ["copyFileSync", "Error|ENOENT|-2|copyfile|<dir>/absent|<dir>/b|ENOENT: no such file or directory, copyfile '<dir>/absent' -> '<dir>/b'"],
  ["linkSync", "Error|ENOENT|-2|link|<dir>/absent|<dir>/b|ENOENT: no such file or directory, link '<dir>/absent' -> '<dir>/b'"],
  ["mkdirSync-exists", "Error|EEXIST|-17|mkdir|<dir>|undefined|EEXIST: file already exists, mkdir '<dir>'"],
  ["rmdirSync-notdir", "Error|ENOTDIR|-20|rmdir|<dir>/f|undefined|ENOTDIR: not a directory, rmdir '<dir>/f'"],
  ["readFileSync-isdir", "Error|EISDIR|-21|read|undefined|undefined|EISDIR: illegal operation on a directory, read"],
  ["closeSync-badfd", "Error|EBADF|-9|close|undefined|undefined|EBADF: bad file descriptor, close"],
  ["fstatSync-badfd", "Error|EBADF|-9|fstat|undefined|undefined|EBADF: bad file descriptor, fstat"],
  ["statSync/buffer", "Error|ENOENT|-2|stat|<dir>/absent|undefined|ENOENT: no such file or directory, stat '<dir>/absent'"],
  ["unlinkSync/buffer", "Error|ENOENT|-2|unlink|<dir>/absent|undefined|ENOENT: no such file or directory, unlink '<dir>/absent'"],
  ["chmodSync/buffer", "Error|ENOENT|-2|chmod|<dir>/absent|undefined|ENOENT: no such file or directory, chmod '<dir>/absent'"],
  ["renameSync/buffer", "Error|ENOENT|-2|rename|<dir>/absent|<dir>/b|ENOENT: no such file or directory, rename '<dir>/absent' -> '<dir>/b'"],
];

const IDENTITY = [
  ["constructor.name", "Error"],
  ["constructor===Error", "true"],
  ["instanceof Error", "true"],
  ["instanceof TypeError", "false"],
  ["name", "Error"],
  ["toString", "Error: ENOENT: no such file or directory, stat '<p>'"],
  ["ownKeys", "code,errno,path,syscall"],
  ["toStringTag", "[object Error]"],
  ["stack-first-line", "Error: ENOENT: no such file or directory, stat '<p>'"],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nts-fse-"));
const f = path.join(dir, "f");
fs.writeFileSync(f, "hello");
const rows = [];
const shape = (label, fn) => {
  try {
    fn();
    rows.push([label, "NO-THROW"]);
  } catch (e) {
    // Split/join rather than `replace`: `String.replace` with a string argument
    // replaces only the first occurrence, and a two-path message names the
    // directory twice. The first version left the raw temp-dir name in the
    // second half and reported all 25 rows as divergent.
    const tail = (v) => v === undefined ? "undefined" : String(v).split(dir).join("<dir>");
    rows.push([label, `${e.constructor.name}|${e.code}|${e.errno}|${e.syscall}|` +
      `${tail(e.path)}|${tail(e.dest)}|${tail(e.message)}`]);
  }
};

try {
const nx = path.join(dir, "absent");
const B = Buffer.from(nx);
shape("statSync", () => fs.statSync(nx));
shape("lstatSync", () => fs.lstatSync(nx));
shape("readFileSync", () => fs.readFileSync(nx));
shape("openSync", () => fs.openSync(nx, "r"));
shape("unlinkSync", () => fs.unlinkSync(nx));
shape("rmdirSync", () => fs.rmdirSync(nx));
shape("chmodSync", () => fs.chmodSync(nx, 0o644));
shape("chownSync", () => fs.chownSync(nx, -1, -1));
shape("utimesSync", () => fs.utimesSync(nx, 0, 0));
shape("readlinkSync", () => fs.readlinkSync(nx));
shape("realpathSync", () => fs.realpathSync(nx));
shape("accessSync", () => fs.accessSync(nx));
shape("readdirSync", () => fs.readdirSync(nx));
shape("opendirSync", () => fs.opendirSync(nx));
shape("renameSync", () => fs.renameSync(nx, path.join(dir, "b")));
shape("copyFileSync", () => fs.copyFileSync(nx, path.join(dir, "b")));
shape("linkSync", () => fs.linkSync(nx, path.join(dir, "b")));
shape("mkdirSync-exists", () => fs.mkdirSync(dir));
shape("rmdirSync-notdir", () => fs.rmdirSync(f));
shape("readFileSync-isdir", () => fs.readFileSync(dir));
shape("closeSync-badfd", () => fs.closeSync(9999));
shape("fstatSync-badfd", () => fs.fstatSync(9999));
// The same calls given a Buffer path, which must report identically.
shape("statSync/buffer", () => fs.statSync(B));
shape("unlinkSync/buffer", () => fs.unlinkSync(B));
shape("chmodSync/buffer", () => fs.chmodSync(B, 0o644));
shape("renameSync/buffer", () => fs.renameSync(B, Buffer.from(path.join(dir, "b"))));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

assert.strictEqual(rows.length, SHAPES.length, "every shape case was reached");
for (let i = 0; i < SHAPES.length; i++) {
  assert.strictEqual(rows[i][0], SHAPES[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], SHAPES[i][1], rows[i][0]);
}

let e;
try {
  fs.statSync("/nonexistent-nts/x");
} catch (error) {
  e = error;
}
const identity = [
  ["constructor.name", e.constructor.name],
  ["constructor===Error", String(e.constructor === Error)],
  ["instanceof Error", String(e instanceof Error)],
  ["instanceof TypeError", String(e instanceof TypeError)],
  ["name", e.name],
  ["toString", e.toString().replace("/nonexistent-nts/x", "<p>")],
  ["ownKeys", Object.keys(e).sort().join(",")],
  ["toStringTag", Object.prototype.toString.call(e)],
  ["stack-first-line", String(e.stack).split("\n")[0].replace("/nonexistent-nts/x", "<p>")],
];
assert.deepStrictEqual(identity, IDENTITY);
