// Web Cryptography §§9, 13.2, 14.1, 15; Web IDL dictionary, enum and sequence
// conversions; RFC 7515 §2 and RFC 4648 §§3.5 and 5.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import {
  JsonWebKey,
  RsaOtherPrimesInfo,
  decodeBase64Url,
  encodeBase64Url,
  normalizeKeyUsages,
  parseWrappedJwk,
  serializeWrappedJwk,
  toJsonWebKey,
  toJsonWebKeyObject,
  toKeyFormat,
  toKeyUsages,
} from "../src/crypto/jwk.ts";

function utf8(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function dataError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "DataError";
}

test("JsonWebKey conversion visits all declared members once in IDL order", () => {
  const order = ["alg", "crv", "d", "dp", "dq", "e", "ext", "k", "key_ops", "kty", "n", "oth", "p", "q", "qi", "use", "x", "y"];
  const reads: string[] = [];
  const input = {};
  // Reflection constructs observable test input; production conversion does not
  // inspect or install descriptors.
  for (const name of order) {
    Object.defineProperty(input, name, { get() { reads.push(name); return undefined; } });
  }
  Object.defineProperty(input, "unknown", { get() { throw new Error("unknown member read"); } });
  const key = toJsonWebKey(input);
  assert.ok(key instanceof JsonWebKey);
  assert.deepEqual(reads, order);
  assert.deepEqual(toJsonWebKeyObject(key), {});
});

test("JsonWebKey conversion applies DOMString, boolean and sequence conversions", () => {
  const key = toJsonWebKey({
    kty: null,
    k: 123,
    alg: true,
    ext: "",
    key_ops: [1, true, null, undefined, { toString() { return "sign"; } }],
    oth: [{ d: 1, r: null, t: false }, null, undefined],
  });
  assert.equal(key.kty, "null");
  assert.equal(key.k, "123");
  assert.equal(key.alg, "true");
  assert.equal(key.ext, false);
  assert.deepEqual(key.key_ops, ["1", "true", "null", "undefined", "sign"]);
  assert.ok(key.oth![0] instanceof RsaOtherPrimesInfo);
  assert.deepEqual(toJsonWebKeyObject(key).oth, [{ d: "1", r: "null", t: "false" }, {}, {}]);
  assert.equal(toJsonWebKey({ ext: [] }).ext, true);
});

test("JsonWebKey accepts empty dictionaries and inherited members", () => {
  assert.deepEqual(toJsonWebKeyObject(toJsonWebKey(null)), {});
  assert.deepEqual(toJsonWebKeyObject(toJsonWebKey(undefined)), {});
  assert.equal(toJsonWebKey(Object.create({ kty: "oct" })).kty, "oct");
  for (const input of [true, 1, 1n, "jwk", Symbol("jwk")]) {
    assert.throws(() => toJsonWebKey(input), TypeError);
  }
  assert.throws(() => toJsonWebKey({ k: Symbol("k") }), TypeError);
});

test("JsonWebKey converts other-prime dictionaries in d, r, t order", () => {
  const reads: string[] = [];
  const prime = {
    get t() { reads.push("t"); return 3; },
    get r() { reads.push("r"); return 2; },
    get d() { reads.push("d"); return 1; },
  };
  const key = toJsonWebKey({ oth: [prime] });
  assert.deepEqual(reads, ["d", "r", "t"]);
  assert.deepEqual(toJsonWebKeyObject(key).oth, [{ d: "1", r: "2", t: "3" }]);
  assert.throws(() => toJsonWebKey({ oth: [1] }), TypeError);
});

test("JWK sequence members reject primitive iterables and non-iterable objects", () => {
  for (const value of [null, "sign", 1, {}, { length: 1, 0: "sign" }]) {
    assert.throws(() => toJsonWebKey({ key_ops: value }), TypeError);
    assert.throws(() => toJsonWebKey({ oth: value }), TypeError);
    assert.throws(() => toKeyUsages(value), TypeError);
  }
  assert.deepEqual(toJsonWebKey({ key_ops: new String("ab") }).key_ops, ["a", "b"]);
});

test("sequence conversion captures next once and ignores callback call properties", () => {
  let reads = 0;
  let index = 0;
  const next = function (this: unknown): { done: boolean; value?: string } {
    assert.equal(this, iterator);
    return index++ === 0 ? { done: false, value: "sign" } : { done: true };
  };
  Object.defineProperty(next, "call", { get() { throw new Error("next.call must not be read"); } });
  const iterator = { get next() { reads++; return next; } };
  const method = function (this: unknown): typeof iterator {
    assert.equal(this, iterable);
    return iterator;
  };
  Object.defineProperty(method, "call", { get() { throw new Error("iterator.call must not be read"); } });
  const iterable = { [Symbol.iterator]: method };
  assert.deepEqual(toKeyUsages(iterable), ["sign"]);
  assert.equal(reads, 1);
});

test("sequence conversion preserves conversion failures without IteratorClose", () => {
  const failure = new Error("usage conversion failed");
  let closed = 0;
  const iterable = {
    [Symbol.iterator]() {
      return {
        next() { return { done: false, value: { toString() { throw failure; } } }; },
        get return() { closed++; throw new Error("return must not be read"); },
      };
    },
  };
  assert.throws(() => toKeyUsages(iterable), (error) => error === failure);
  assert.equal(closed, 0);
});

test("sequence conversion checks iterator and result shapes and observes done before value", () => {
  for (const iterable of [
    { [Symbol.iterator]: 1 },
    { [Symbol.iterator]() { return 1; } },
    { [Symbol.iterator]() { return { next: 1 }; } },
    { [Symbol.iterator]() { return { next() { return 1; } }; } },
  ]) assert.throws(() => toKeyUsages(iterable), TypeError);
  const iterable = {
    [Symbol.iterator]() {
      return { next() { return { done: true, get value(): never { throw new Error("done value read"); } }; } };
    },
  };
  assert.deepEqual(toKeyUsages(iterable), []);
});

test("key formats convert to a case-sensitive Web IDL enum", () => {
  for (const format of ["raw", "spki", "pkcs8", "jwk"] as const) assert.equal(toKeyFormat(format), format);
  let conversions = 0;
  assert.equal(toKeyFormat({ toString() { conversions++; return "raw"; } }), "raw");
  assert.equal(conversions, 1);
  for (const format of [undefined, null, "RAW", "raw ", "", Symbol("raw")]) {
    assert.throws(() => toKeyFormat(format), TypeError);
  }
});

test("key usage conversion keeps input order and normalization orders and deduplicates it", () => {
  const all: KeyUsage[] = ["encrypt", "decrypt", "sign", "verify", "deriveKey", "deriveBits", "wrapKey", "unwrapKey"];
  assert.deepEqual(toKeyUsages(all), all);
  const input = toKeyUsages(["unwrapKey", "verify", "encrypt", "verify", "deriveBits"]);
  assert.deepEqual(input, ["unwrapKey", "verify", "encrypt", "verify", "deriveBits"]);
  assert.deepEqual(normalizeKeyUsages(input), ["encrypt", "verify", "deriveBits", "unwrapKey"]);
  for (const usage of ["Encrypt", "encrypt ", "unknown", undefined, Symbol("sign")]) {
    assert.throws(() => toKeyUsages([usage]), TypeError);
  }
});

test("public JWK conversion omits absent members and copies sequence dictionaries", () => {
  const internal = toJsonWebKey({ kty: "oct", k: "AA", ext: false, key_ops: ["sign"], oth: [{ r: "AQ" }] });
  const first = toJsonWebKeyObject(internal);
  const second = toJsonWebKeyObject(internal);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.deepEqual(Object.keys(first), ["ext", "k", "key_ops", "kty", "oth"]);
  assert.notEqual(first.key_ops, second.key_ops);
  assert.notEqual(first.oth, second.oth);
  assert.notEqual(first.oth![0], second.oth![0]);
  first.key_ops!.push("verify");
  first.oth![0]!.r = "changed";
  assert.deepEqual(second.key_ops, ["sign"]);
  assert.equal(second.oth![0]!.r, "AQ");
  assert.deepEqual(internal.key_ops, ["sign"]);
});

test("public JWK conversion creates own fields without inherited setter calls", () => {
  const internal = toJsonWebKey({ alg: "HS256", ext: true, k: "AA", key_ops: ["sign"], kty: "oct" });
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "kty");
  let setterCalls = 0;
  let exported: ReturnType<typeof toJsonWebKeyObject>;
  try {
    Object.defineProperty(Object.prototype, "kty", {
      configurable: true,
      set() { setterCalls++; },
    });
    exported = toJsonWebKeyObject(internal);
  } finally {
    if (original === undefined) delete (Object.prototype as { kty?: unknown }).kty;
    else Object.defineProperty(Object.prototype, "kty", original);
  }
  assert.equal(setterCalls, 0);
  assert.deepEqual(Object.keys(exported), ["alg", "ext", "k", "key_ops", "kty"]);
  assert.equal(exported.kty, "oct");
  assert.deepEqual(exported.key_ops, ["sign"]);
  assert.notEqual(exported.key_ops, internal.key_ops);
});

for (const [plain, encoded] of [
  ["", ""], ["f", "Zg"], ["fo", "Zm8"], ["foo", "Zm9v"],
  ["foob", "Zm9vYg"], ["fooba", "Zm9vYmE"], ["foobar", "Zm9vYmFy"],
] as const) {
  test("base64url encodes and decodes the RFC 4648 vector " + JSON.stringify(plain), () => {
    assert.equal(encodeBase64Url(utf8(plain)), encoded);
    assert.equal(text(decodeBase64Url(encoded)), plain);
  });
}

test("base64url covers every byte value and the URL alphabet", () => {
  const input = new Uint8Array(256);
  for (let index = 0; index < input.length; index++) input[index] = index;
  assert.equal(encodeBase64Url(input), Buffer.from(input).toString("base64url"));
  assert.deepEqual(decodeBase64Url(encodeBase64Url(input)), input);
  assert.equal(encodeBase64Url(new Uint8Array([251, 255])), "-_8");
});

test("base64url rejects padding, whitespace, standard alphabet and impossible lengths", () => {
  for (const input of ["A", "abcde", "=", "Zg=", "Zg==", "Z g", "Zg\n", "Zg+", "Zg/", "ＡＡ", "💩"]) {
    assert.throws(() => decodeBase64Url(input), dataError, input);
  }
});

test("base64url accepts noncanonical unused bits and exports canonical encoding", () => {
  for (const encoded of ["Zh", "Zv"]) assert.equal(encodeBase64Url(decodeBase64Url(encoded)), "Zg");
  for (const encoded of ["Zm9", "Zm_"]) assert.equal(encodeBase64Url(decodeBase64Url(encoded)), "Zm8");
});

test("base64url encoding reads the intrinsic byte length", { skip: "redefining an intrinsic accessor is something nts programs cannot do" }, () => {
  class Bytes extends Uint8Array {
    override get byteLength(): number { throw new Error("byteLength getter read"); }
  }
  assert.equal(encodeBase64Url(new Bytes([251, 255])), "-_8");
});

test("wrapped JWK parsing preserves JSON and dictionary conversion errors", () => {
  for (const source of ["", "{", '{"kty":"oct",}', "undefined"]) {
    assert.throws(() => parseWrappedJwk(utf8(source)), SyntaxError);
  }
  for (const source of ["1", "true", '"oct"', '{"key_ops":"sign"}', '{"oth":null}', '{"oth":[1]}']) {
    assert.throws(() => parseWrappedJwk(utf8(source)), TypeError);
  }
  for (const source of ["null", "[]", "{}"]) {
    assert.throws(() => parseWrappedJwk(utf8(source)), dataError);
  }
});

test("wrapped JWK parsing reproduces fresh-realm DOMString and boolean conversion", () => {
  const parsed = parseWrappedJwk(utf8('{"kty":["o","c","t"],"k":[["Zg"],null,[]],"alg":{},"ext":[],"key_ops":[true,null,[1,2],{}],"oth":[{"d":1,"r":null,"t":false},null,[]]}'));
  assert.equal(parsed.kty, "o,c,t");
  assert.equal(parsed.k, "Zg,,");
  assert.equal(parsed.alg, "[object Object]");
  assert.equal(parsed.ext, true);
  assert.deepEqual(parsed.key_ops, ["true", "null", "1,2", "[object Object]"]);
  assert.deepEqual(toJsonWebKeyObject(parsed).oth, [{ d: "1", r: "null", t: "false" }, {}, {}]);
  assert.throws(() => parseWrappedJwk(utf8('{"alg":{"toString":null}}')), TypeError);
  assert.equal(parseWrappedJwk(utf8('{"toString":null,"kty":"oct"}')).kty, "oct");
});

test("wrapped JWK parsing uses duplicate members' last values and ignores __proto__", () => {
  const parsed = parseWrappedJwk(utf8('{"kty":"bad","kty":"oct","__proto__":{"k":"polluted"}}'));
  assert.equal(parsed.kty, "oct");
  assert.equal(parsed.k, undefined);
});

test("wrapped JWK parsing replacement-decodes UTF-8 and accepts a leading BOM", () => {
  const valid = utf8('{"kty":"oct","k":"AA"}');
  const bom = new Uint8Array(valid.length + 3);
  bom.set([0xef, 0xbb, 0xbf]);
  bom.set(valid, 3);
  assert.equal(parseWrappedJwk(bom).k, "AA");
  const prefix = Buffer.from('{"kty":"oct","ignored":"');
  const suffix = Buffer.from('","k":"AA"}');
  const malformed = new Uint8Array(Buffer.concat([prefix, Buffer.from([255]), suffix]));
  assert.equal(parseWrappedJwk(malformed).k, "AA");
  assert.equal(parseWrappedJwk(utf8('{"kty":"oct","alg":"\\ud800"}')).alg, "\ud800");
});

test("wrapped JWK conversions ignore caller Object and Array string hooks", () => {
  const originalObjectString = Object.prototype.toString;
  const originalJoin = Array.prototype.join;
  const originalParse = JSON.parse;
  let parsed: JsonWebKey;
  try {
    Object.prototype.toString = () => { throw new Error("caller Object.toString"); };
    Array.prototype.join = () => { throw new Error("caller Array.join"); };
    JSON.parse = () => { throw new Error("caller JSON.parse"); };
    parsed = parseWrappedJwk(utf8('{"kty":"oct","alg":{},"key_ops":[["sign","verify"]]}'));
  } finally {
    Object.prototype.toString = originalObjectString;
    Array.prototype.join = originalJoin;
    JSON.parse = originalParse;
  }
  assert.equal(parsed.alg, "[object Object]");
  assert.deepEqual(parsed.key_ops, ["sign,verify"]);
});

test("generated oct JWK serialization is independent and may pad for AES-KW", () => {
  const key = toJsonWebKey({ kty: "oct", k: "AA", alg: "HS256", key_ops: ["sign"], ext: false });
  const unpadded = serializeWrappedJwk(key, false);
  const padded = serializeWrappedJwk(key, true);
  assert.equal(text(unpadded), '{"alg":"HS256","ext":false,"k":"AA","key_ops":["sign"],"kty":"oct"}');
  assert.equal(padded.length % 8, 0);
  assert.ok(padded.length >= unpadded.length && padded.length < unpadded.length + 8);
  assert.deepEqual(toJsonWebKeyObject(parseWrappedJwk(padded)), toJsonWebKeyObject(key));
  assert.throws(() => serializeWrappedJwk(new JsonWebKey(), false), TypeError);
});

test("wrapped JWK serialization never calls JSON.stringify or toJSON hooks", () => {
  const key = toJsonWebKey({ kty: "oct", k: "AA", alg: "HS256", key_ops: ["sign"], ext: true });
  const originalStringify = JSON.stringify;
  const objectHook = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const arrayHook = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  let encoded: Uint8Array;
  try {
    JSON.stringify = () => { throw new Error("caller JSON.stringify"); };
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { throw new Error("caller Object.toJSON"); } });
    Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value() { throw new Error("caller Array.toJSON"); } });
    encoded = serializeWrappedJwk(key, false);
  } finally {
    JSON.stringify = originalStringify;
    if (objectHook === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
    else Object.defineProperty(Object.prototype, "toJSON", objectHook);
    if (arrayHook === undefined) delete (Array.prototype as { toJSON?: unknown }).toJSON;
    else Object.defineProperty(Array.prototype, "toJSON", arrayHook);
  }
  assert.equal(parseWrappedJwk(encoded).k, "AA");
});

test("late String, Array and Math replacements do not enter JWK serialization or base64", () => {
  const key = toJsonWebKey({ kty: "oct", k: "AA", alg: "HS256", key_ops: ["sign"], ext: true });
  const originalCode = String.prototype.charCodeAt;
  const originalSlice = String.prototype.slice;
  const originalPush = Array.prototype.push;
  const originalFloor = Math.floor;
  let encoded: string;
  let decoded: Uint8Array;
  let wrapped: Uint8Array;
  try {
    String.prototype.charCodeAt = () => { throw new Error("late charCodeAt"); };
    String.prototype.slice = () => { throw new Error("late String.slice"); };
    Array.prototype.push = () => { throw new Error("late Array.push"); };
    Math.floor = () => { throw new Error("late Math.floor"); };
    encoded = encodeBase64Url(new Uint8Array([251, 255]));
    decoded = decodeBase64Url("-_8");
    wrapped = serializeWrappedJwk(key, true);
  } finally {
    String.prototype.charCodeAt = originalCode;
    String.prototype.slice = originalSlice;
    Array.prototype.push = originalPush;
    Math.floor = originalFloor;
  }
  assert.equal(encoded, "-_8");
  assert.deepEqual([...decoded], [251, 255]);
  assert.equal(wrapped.byteLength % 8, 0);
  assert.equal(parseWrappedJwk(wrapped).k, "AA");
});
