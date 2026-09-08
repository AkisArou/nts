"use strict";

// HTTP header bookkeeping, where the name you pass and the name that is stored
// are not the same string.
//
// Node keeps one lower-cased map plus the original spellings, and every
// accessor goes through it, so upstream `getHeader`, `hasHeader` and
// `removeHeader` cannot disagree about case. Here they are separate methods over
// separate storage, and each is a chance to lower-case in one place and not
// another.
//
// 22 cases, 0 divergences. The ones that matter:
//
//   `setHeader("X-Foo")` then `getHeader("x-foo")` finds it
//   `hasHeader("X-FOO")` and `removeHeader("x-FOO")` find it too
//   `getHeaderNames()` answers **lower-cased**, `getHeaders()` keys likewise
//   setting `"a"` then `"A"` overwrites rather than adding a second entry
//   `getHeaders()` has a **null prototype**, so `hasOwnProperty` is absent
//   an array value round-trips as an array; a number round-trips as a number
//   `getHeader` on a missing name is `undefined`, `hasHeader` is `false`, and
//     `removeHeader` on a missing name does not throw
//
// Plus the tables: `STATUS_CODES[404]`, how many status codes there are,
// `METHODS` containing `PATCH` and its length, whether `METHODS` is sorted, and
// the type of `maxHeaderSize`. Those are constants a port can get subtly wrong
// and nothing upstream enumerates, because upstream they are generated.
//
// The invalid-input rows are the interesting half: a header name with a space,
// an empty name, a value containing a newline, and an `undefined` value. Node
// rejects some and accepts others, and *which* is not derivable — it is what the
// validator happens to check. Every expected value read off node v24.20.0.

const assert = require("node:assert");
const http = require("node:http");

const EXPECTED = [
  ["set-then-get-other-case", "1"],
  ["set-then-has-other-case", "true"],
  ["getHeaderNames-lowercased", "x-foo,y-bar"],
  ["getHeaders-keys", "x-foo"],
  ["getHeaders-null-proto", "null"],
  ["set-twice-overwrites", "2|a"],
  ["remove-other-case", "false"],
  ["array-value", "[\"1\",\"2\"]"],
  ["number-value", "5"],
  ["get-missing", "undefined"],
  ["has-missing", "false"],
  ["remove-missing", "undefined"],
  ["invalid-name-space", "THROW:ERR_INVALID_HTTP_TOKEN"],
  ["invalid-name-empty", "THROW:ERR_INVALID_HTTP_TOKEN"],
  ["invalid-value-newline", "THROW:ERR_INVALID_CHAR"],
  ["undefined-value", "THROW:ERR_HTTP_INVALID_HEADER_VALUE"],
  ["STATUS_CODES-404", "Not Found"],
  ["STATUS_CODES-count", "63"],
  ["METHODS-includes", "true|35"],
  ["METHODS-sorted", "true"],
  ["maxHeaderSize-type", "number"],
  ["validateHeaderName-bad", "THROW:ERR_INVALID_HTTP_TOKEN"],
  ["validateHeaderValue-bad", "THROW:ERR_INVALID_CHAR"],
];

const rows = [];
const record = (label, fn) => {
  try {
    rows.push([label, String(fn())]);
  } catch (e) {
    rows.push([label, "THROW:" + (e.code || e.constructor.name)]);
  }
};

const msg = () => new http.OutgoingMessage();
// Header names are case-insensitive for get/has/remove but keep their spelling.
record("set-then-get-other-case", () => { const m = msg(); m.setHeader("X-Foo", "1"); return m.getHeader("x-foo"); });
record("set-then-has-other-case", () => { const m = msg(); m.setHeader("X-Foo", "1"); return m.hasHeader("X-FOO"); });
record("getHeaderNames-lowercased", () => { const m = msg(); m.setHeader("X-Foo", "1"); m.setHeader("Y-Bar", "2"); return m.getHeaderNames().sort().join(","); });
record("getHeaders-keys", () => { const m = msg(); m.setHeader("X-Foo", "1"); return Object.keys(m.getHeaders()).join(","); });
record("getHeaders-null-proto", () => { const m = msg(); m.setHeader("a", "1"); return String(Object.getPrototypeOf(m.getHeaders())); });
record("set-twice-overwrites", () => { const m = msg(); m.setHeader("a", "1"); m.setHeader("A", "2"); return m.getHeader("a") + "|" + m.getHeaderNames().join(","); });
record("remove-other-case", () => { const m = msg(); m.setHeader("X-Foo", "1"); m.removeHeader("x-FOO"); return String(m.hasHeader("x-foo")); });
record("array-value", () => { const m = msg(); m.setHeader("a", ["1", "2"]); return JSON.stringify(m.getHeader("a")); });
record("number-value", () => { const m = msg(); m.setHeader("a", 5); return JSON.stringify(m.getHeader("a")); });
record("get-missing", () => String(msg().getHeader("nope")));
record("has-missing", () => String(msg().hasHeader("nope")));
record("remove-missing", () => String(msg().removeHeader("nope")));
record("invalid-name-space", () => { const m = msg(); m.setHeader("a b", "1"); return "no-throw"; });
record("invalid-name-empty", () => { const m = msg(); m.setHeader("", "1"); return "no-throw"; });
record("invalid-value-newline", () => { const m = msg(); m.setHeader("a", "1\n2"); return "no-throw"; });
record("undefined-value", () => { const m = msg(); m.setHeader("a", undefined); return "no-throw"; });
record("STATUS_CODES-404", () => http.STATUS_CODES[404]);
record("STATUS_CODES-count", () => Object.keys(http.STATUS_CODES).length);
record("METHODS-includes", () => http.METHODS.includes("PATCH") + "|" + String(http.METHODS.length));
record("METHODS-sorted", () => String(http.METHODS.join(",") === [...http.METHODS].sort().join(",")));
record("maxHeaderSize-type", () => typeof http.maxHeaderSize);
record("validateHeaderName-bad", () => { http.validateHeaderName("a b"); return "no-throw"; });
record("validateHeaderValue-bad", () => { http.validateHeaderValue("a", "x\ny"); return "no-throw"; });

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
