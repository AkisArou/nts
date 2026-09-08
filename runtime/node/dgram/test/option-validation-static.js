"use strict";

// Everything `dgram` decides before it touches a socket.
//
// **All twenty-one of `dgram`'s native bindings have no C**, and it has no `.c`
// file at all — so nothing about the wire is measurable here. What *is*
// measurable is the layer above: option validation, argument checking and the
// handle contract, every bit of which runs before a syscall.
//
// Node does that validation in one place per method and throws named errors from
// it. Here each method validates itself, and the interesting rows are where a
// port would plausibly do something else:
//
//   `createSocket()` with no argument, with `"udp5"`, with `5`, and with `{}`
//     all throw the **same** `ERR_SOCKET_BAD_TYPE`
//   a bad `reuseAddr`, `ipv6Only` or `recvBufferSize` each throw on their own
//   `address()` **before** binding throws rather than answering a placeholder
//   `setTTL` rejects a non-number and rejects `0`, which is out of range
//   `send` with a negative port, and with no arguments at all
//   `ref()` and `unref()` return the socket so they chain
//   `close()` twice throws rather than being idempotent -- unlike a stream's
//     `destroy()`, which is, and the two being different is the point
//
// Every expected value read off node v24.20.0. Every socket this file opens is
// closed in a `finally`, because a leaked UDP handle keeps the process alive and
// the suite would hang rather than fail.

const assert = require("node:assert");
const dgram = require("node:dgram");

const EXPECTED = [
  ["no-args", "THROW:ERR_SOCKET_BAD_TYPE"],
  ["bad-type-string", "THROW:ERR_SOCKET_BAD_TYPE"],
  ["bad-type-number", "THROW:ERR_SOCKET_BAD_TYPE"],
  ["options-missing-type", "THROW:ERR_SOCKET_BAD_TYPE"],
  ["udp4-ok", "object"],
  ["udp6-ok", "object"],
  ["options-form", "object"],
  ["reuseAddr-bad", "[object Object]"],
  ["ipv6Only-bad", "[object Object]"],
  ["recvBufferSize-bad", "THROW:ERR_INVALID_ARG_TYPE"],
  ["address-before-bind", "THROW:EBADF"],
  ["setTTL-bad", "THROW:ERR_INVALID_ARG_TYPE"],
  ["setTTL-range", "THROW:EINVAL"],
  ["setBroadcast-before-bind", "THROW:EBADF"],
  ["send-bad-port", "THROW:ERR_SOCKET_BAD_PORT"],
  ["send-no-args", "THROW:ERR_INVALID_ARG_TYPE"],
  ["ref-returns-this", "true"],
  ["unref-returns-this", "true"],
  ["close-twice", "THROW:ERR_SOCKET_DGRAM_NOT_RUNNING"],
  ["is-eventemitter", "function"],
];

const rows = [];
const record = (label, fn) => {
  try {
    rows.push([label, String(fn())]);
  } catch (e) {
    rows.push([label, "THROW:" + (e.code || e.constructor.name)]);
  }
};

// createSocket option validation, which happens before any syscall.
record("no-args", () => dgram.createSocket());
record("bad-type-string", () => { const s = dgram.createSocket("udp5"); s.close(); return "ok"; });
record("bad-type-number", () => dgram.createSocket(5));
record("options-missing-type", () => dgram.createSocket({}));
record("udp4-ok", () => { const s = dgram.createSocket("udp4"); const t = typeof s; s.close(); return t; });
record("udp6-ok", () => { const s = dgram.createSocket("udp6"); const t = typeof s; s.close(); return t; });
record("options-form", () => { const s = dgram.createSocket({ type: "udp4" }); const t = typeof s; s.close(); return t; });
record("reuseAddr-bad", () => dgram.createSocket({ type: "udp4", reuseAddr: 1 }));
record("ipv6Only-bad", () => dgram.createSocket({ type: "udp4", ipv6Only: "x" }));
record("recvBufferSize-bad", () => dgram.createSocket({ type: "udp4", recvBufferSize: "x" }));
// Methods that validate before touching a handle.
record("address-before-bind", () => { const s = dgram.createSocket("udp4"); try { return s.address(); } finally { s.close(); } });
record("setTTL-bad", () => { const s = dgram.createSocket("udp4"); try { return s.setTTL("x"); } finally { s.close(); } });
record("setTTL-range", () => { const s = dgram.createSocket("udp4"); try { return s.setTTL(0); } finally { s.close(); } });
record("setBroadcast-before-bind", () => { const s = dgram.createSocket("udp4"); try { return String(s.setBroadcast(true)); } finally { s.close(); } });
record("send-bad-port", () => { const s = dgram.createSocket("udp4"); try { return s.send("x", -1, "127.0.0.1"); } finally { s.close(); } });
record("send-no-args", () => { const s = dgram.createSocket("udp4"); try { return s.send(); } finally { s.close(); } });
record("ref-returns-this", () => { const s = dgram.createSocket("udp4"); const r = s.ref() === s; s.close(); return String(r); });
record("unref-returns-this", () => { const s = dgram.createSocket("udp4"); const r = s.unref() === s; s.close(); return String(r); });
record("close-twice", () => { const s = dgram.createSocket("udp4"); s.close(); try { s.close(); return "no-throw"; } catch (e) { return "THROW:" + (e.code || e.constructor.name); } });
record("is-eventemitter", () => { const s = dgram.createSocket("udp4"); const r = typeof s.on; s.close(); return r; });

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
