"use strict";

// Supported typed behavior retained from Node v24.20.0
// test/parallel/test-querystring-escape.js. The omitted object and array
// inputs require ToPrimitive/valueOf/toString dispatch, a §9/§13 non-goal;
// @types/node exposes this API as escape(string).
const assert = require("assert");
const qs = require("querystring");

assert.strictEqual(qs.escape("test"), "test");
assert.strictEqual(qs.escape("Ŋōđĕ"), "%C5%8A%C5%8D%C4%91%C4%95");
assert.strictEqual(qs.escape("testŊōđĕ"), "test%C5%8A%C5%8D%C4%91%C4%95");
assert.strictEqual(qs.escape(`${String.fromCharCode(0xd801)}test`), "%F0%90%91%B4est");

assert.throws(() => qs.escape(String.fromCharCode(0xd801)), {
  code: "ERR_INVALID_URI",
  name: "URIError",
  message: "URI malformed",
});
