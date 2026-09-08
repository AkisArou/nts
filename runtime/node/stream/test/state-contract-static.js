"use strict";

// Stream state, where the answer is a contract rather than a computation.
//
// Node keeps one `WritableState` and one `ReadableState`, so upstream
// `writableEnded`, `writableFinished` and `destroyed` cannot disagree with each
// other -- they are fields of one object updated in one place. Here they are
// separate accessors over separate bookkeeping.
//
// The cases are the ones where the contract is easy to state and easy to get
// subtly wrong:
//
//   `write()` answers `false` once the buffer reaches highWaterMark, not after
//   `destroy()`, `setEncoding()` and `pause()` return the stream so they chain
//   `destroy()` twice is idempotent rather than an error
//   `push(null)` then `push(x)` is `ERR_STREAM_PUSH_AFTER_EOF`
//   `read()` on an empty stream is `null`, not `undefined`
//   `readableFlowing` is `null` before anything, then `false` after `pause()`
//   `cork()`/`uncork()` routes two writes through `writev` as one call
//   the default highWaterMark differs between byte mode and object mode
//
// **Two cases resolve on a timer rather than on an error, and that is the
// point.** `end()` twice emits *nothing* on node; the first version of this
// harness resolved only from the error handler, so that case never resolved,
// `Promise.all` never fired, the output file was never written -- and the
// comparison read the *previous* run's file and reported a clean pass. "No
// error" is a real answer and a harness that can only record errors cannot see
// it.

const assert = require("node:assert");
const { Readable, Writable, Transform, PassThrough } = require("node:stream");

const EXPECTED = [
  ["cork-uncork", "v2"],
  ["destroy-returns-this", "true"],
  ["destroy-twice", "true"],
  ["end-twice", "none"],
  ["highWaterMark-default", "65536"],
  ["objectMode-hwm-default", "16"],
  ["passthrough-is-transform", "true"],
  ["pause-resume-flowing", "null,false,true"],
  ["push-after-eof", "none"],
  ["read-empty", "null"],
  ["readable-flags", "true,false,false,"],
  ["setEncoding-returns-this", "true"],
  ["writable-flags", "true,false,false,false|false,true,false"],
  ["write-after-end", "ERR_STREAM_WRITE_AFTER_END"],
  ["write-returns", "false,false,false"],
];

const rows = [];
const record = (label, fn) => {
  try {
    rows.push([label, String(fn())]);
  } catch (e) {
    rows.push([label, "THROW:" + (e.code || e.constructor.name)]);
  }
};

// write() answers false once the buffer is at or past highWaterMark.
record("write-returns", () => {
  const w = new Writable({ highWaterMark: 2, write(c, e, cb) {} });
  return [w.write("ab"), w.write("cd"), w.write("ef")].join(",");
});
record("writable-flags", () => {
  const w = new Writable({ write(c, e, cb) { cb(); } });
  const before = [w.writable, w.writableEnded, w.writableFinished, w.destroyed].join(",");
  w.end();
  return before + "|" + [w.writable, w.writableEnded, w.destroyed].join(",");
});
record("readable-flags", () => {
  const r = Readable.from(["a"]);
  return [r.readable, r.readableEnded, r.destroyed, r.readableFlowing].join(",");
});
record("push-after-eof", () => {
  const r = new Readable({ read() {} });
  r.push(null);
  let code = "none";
  r.on("error", (e) => { code = e.code; });
  r.push("x");
  return code;
});
record("read-empty", () => {
  const r = new Readable({ read() {} });
  return String(r.read());
});
record("destroy-twice", () => {
  const r = new Readable({ read() {} });
  r.destroy();
  r.destroy();
  return String(r.destroyed);
});
record("destroy-returns-this", () => {
  const r = new Readable({ read() {} });
  return String(r.destroy() === r);
});
record("setEncoding-returns-this", () => {
  const r = new Readable({ read() {} });
  return String(r.setEncoding("utf8") === r);
});
record("pause-resume-flowing", () => {
  const r = new Readable({ read() {} });
  const a = String(r.readableFlowing);
  r.pause();
  const b = String(r.readableFlowing);
  r.resume();
  return a + "," + b + "," + String(r.readableFlowing);
});
record("highWaterMark-default", () => new Readable({ read() {} }).readableHighWaterMark);
record("objectMode-hwm-default", () => new Readable({ read() {}, objectMode: true }).readableHighWaterMark);
record("passthrough-is-transform", () => String(new PassThrough() instanceof Transform));
record("cork-uncork", () => {
  const seen = [];
  const w = new Writable({ write(c, e, cb) { seen.push(String(c)); cb(); },
    writev(chunks, cb) { seen.push("v" + chunks.length); cb(); } });
  w.cork(); w.write("a"); w.write("b"); w.uncork();
  return seen.join(",");
});
const pending = [];
// Every case resolves on a later tick whether or not an error arrived. The
// first version resolved only from the error handler, so `end-twice` -- which
// emits nothing on node -- never resolved, `Promise.all` never fired, and the
// output file was never written. The comparison then read the *previous* run's
// file and reported a clean pass. A harness that can silently compare stale data
// is worse than one that fails.
const later = (label, fn) => {
  pending.push(new Promise((resolve) => {
    let code = "none";
    fn((c) => { code = c; });
    setTimeout(() => { rows.push([label, code]); resolve(); }, 20);
  }));
};
later("write-after-end", (set) => {
  const w = new Writable({ write(c, e, cb) { cb(); } });
  w.on("error", (e) => set(e.code));
  w.end();
  w.write("x");
});
// Node emits nothing for a second `end()`. Kept precisely because "no error"
// is the answer, and a case that resolves only on an error could never record it.
later("end-twice", (set) => {
  const w = new Writable({ write(c, e, cb) { cb(); } });
  w.on("error", (e) => set(e.code));
  w.end();
  w.end();
});

Promise.all(pending).then(() => {
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
  for (let i = 0; i < EXPECTED.length; i++) {
    assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
    assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
  }
});
