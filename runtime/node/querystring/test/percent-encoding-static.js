"use strict";

// Percent-encoding edge cases, which node has four test files for.
//
// One of those four touches a malformed escape and **none touches a surrogate or
// a non-BMP character at all**. That is reasonable upstream: node's decoder is
// one piece of C++ and a malformed escape either produces U+FFFD in the right
// place or does not. Here `parse`, `unescape` and `escape` are TypeScript with
// their own scanning, and where a replacement character lands is a real degree of
// freedom.
//
// Fifty-eight cases, all read off node v24.20.0. The ones worth naming:
//
//     %              a lone percent with nothing after it
//     %a             one hex digit, truncated
//     %E4%BD         a truncated three-byte sequence
//     %C0%80         an overlong encoding of NUL
//     %ED%A0%80      a *lone surrogate*, which is well-formed percent-encoding
//                    of ill-formed UTF-8
//     %F0%9F%98%80   a four-byte sequence, valid
//
// Plus the structural ones nothing upstream pins either: `__proto__` as a key,
// a bare key with no `=`, an empty key, repeated keys, `;` as a separator (not
// one, in node), and a leading `?` (not stripped).

const assert = require("node:assert");
const qs = require("node:querystring");

const EXPECTED = [
  ["parse/%", "{\"%\":\"\"}"],
  ["unescape/%", "\"%\""],
  ["parse/%a", "{\"%a\":\"\"}"],
  ["unescape/%a", "\"%a\""],
  ["parse/%zz", "{\"%zz\":\"\"}"],
  ["unescape/%zz", "\"%zz\""],
  ["parse/a=%", "{\"a\":\"%\"}"],
  ["unescape/a=%", "\"a=%\""],
  ["parse/a=%z", "{\"a\":\"%z\"}"],
  ["unescape/a=%z", "\"a=%z\""],
  ["parse/a=%E4%BD", "{\"a\":\"\ufffd\"}"],
  ["unescape/a=%E4%BD", "\"a=\ufffd\""],
  ["parse/a=%FF", "{\"a\":\"\ufffd\"}"],
  ["unescape/a=%FF", "\"a=\ufffd\""],
  ["parse/a=%C0%80", "{\"a\":\"\ufffd\ufffd\"}"],
  ["unescape/a=%C0%80", "\"a=\ufffd\ufffd\""],
  ["parse/a=%ED%A0%80", "{\"a\":\"\ufffd\ufffd\ufffd\"}"],
  ["unescape/a=%ED%A0%80", "\"a=\ufffd\ufffd\ufffd\""],
  ["parse/a=%F0%9F%98%80", "{\"a\":\"\ud83d\ude00\"}"],
  ["unescape/a=%F0%9F%98%80", "\"a=\ud83d\ude00\""],
  ["parse/a=%2F%2f", "{\"a\":\"//\"}"],
  ["unescape/a=%2F%2f", "\"a=//\""],
  ["parse/%3D=%26", "{\"=\":\"&\"}"],
  ["unescape/%3D=%26", "\"==&\""],
  ["parse/a=1&a=2&a=3", "{\"a\":[\"1\",\"2\",\"3\"]}"],
  ["parse/a", "{\"a\":\"\"}"],
  ["parse/=1", "{\"\":\"1\"}"],
  ["parse/a=", "{\"a\":\"\"}"],
  ["parse/&&", "{}"],
  ["parse/a=1&&b=2", "{\"a\":\"1\",\"b\":\"2\"}"],
  ["parse/__proto__=x", "{\"__proto__\":\"x\"}"],
  ["parse/a[]=1&a[]=2", "{\"a[]\":[\"1\",\"2\"]}"],
  ["parse/a=1;b=2", "{\"a\":\"1;b=2\"}"],
  ["parse/?a=1", "{\"?a\":\"1\"}"],
  ["stringify/ascii", "\"a=b\""],
  ["roundtrip/ascii", "{\"a\":\"b\"}"],
  ["stringify/space", "\"a%20b=c%20d\""],
  ["roundtrip/space", "{\"a b\":\"c d\"}"],
  ["stringify/plus", "\"a=b%2Bc\""],
  ["roundtrip/plus", "{\"a\":\"b+c\"}"],
  ["stringify/nonbmp", "\"a=%F0%9F%98%80\""],
  ["roundtrip/nonbmp", "{\"a\":\"\ud83d\ude00\"}"],
  ["stringify/cjk", "\"a=%E4%BD%A0%E5%A5%BD\""],
  ["roundtrip/cjk", "{\"a\":\"\u4f60\u597d\"}"],
  ["stringify/array", "\"a=1&a=2\""],
  ["roundtrip/array", "{\"a\":[\"1\",\"2\"]}"],
  ["stringify/empty-value", "\"a=\""],
  ["roundtrip/empty-value", "{\"a\":\"\"}"],
  ["stringify/number", "\"a=1\""],
  ["roundtrip/number", "{\"a\":\"1\"}"],
  ["stringify/bool", "\"a=true\""],
  ["roundtrip/bool", "{\"a\":\"true\"}"],
  ["stringify/null", "\"a=\""],
  ["roundtrip/null", "{\"a\":\"\"}"],
  ["stringify/nested", "\"a=\""],
  ["roundtrip/nested", "{\"a\":\"\"}"],
  ["escape/nonbmp", "\"%F0%9F%98%80\""],
  ["escape/space", "\"a%20b\""],
  ["escape/reserved", "\"!'()*-._~\""],
];

const results = [];
const attempt = (label, fn) => {
  let out;
  try { out = JSON.stringify(fn()); } catch (error) { out = `THROW:${error.code ?? error.constructor.name}`; }
  results.push([label, out]);
};

for (const s of ["%", "%a", "%zz", "a=%", "a=%z", "a=%E4%BD", "a=%FF", "a=%C0%80",
                 "a=%ED%A0%80", "a=%F0%9F%98%80", "a=%2F%2f", "%3D=%26"]) {
  attempt(`parse/${s}`, () => qs.parse(s));
  attempt(`unescape/${s}`, () => qs.unescape(s));
}
for (const s of ["a=1&a=2&a=3", "a", "=1", "a=", "&&", "a=1&&b=2", "__proto__=x",
                 "a[]=1&a[]=2", "a=1;b=2", "?a=1"]) {
  attempt(`parse/${s}`, () => qs.parse(s));
}
for (const [label, v] of [
  ["ascii", { a: "b" }],
  ["space", { "a b": "c d" }],
  ["plus", { a: "b+c" }],
  ["nonbmp", { a: "😀" }],
  ["cjk", { a: "你好" }],
  ["array", { a: ["1", "2"] }],
  ["empty-value", { a: "" }],
  ["number", { a: 1 }],
  ["bool", { a: true }],
  ["null", { a: null }],
  ["nested", { a: { b: 1 } }],
]) {
  attempt(`stringify/${label}`, () => qs.stringify(v));
  attempt(`roundtrip/${label}`, () => qs.parse(qs.stringify(v)));
}
attempt("escape/nonbmp", () => qs.escape("😀"));
attempt("escape/space", () => qs.escape("a b"));
attempt("escape/reserved", () => qs.escape("!'()*-._~"));

assert.strictEqual(results.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(results[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(results[i][1], EXPECTED[i][1], results[i][0]);
}
