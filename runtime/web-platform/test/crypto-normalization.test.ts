// Web Cryptography §§18.4.4, 27.3–27.5, 28.3, 29.3, 31.3 and 31.5.
// https://w3c.github.io/webcrypto/#algorithm-normalization-normalize-an-algorithm
// Web IDL §§3.2.4.9 and 3.2.17: https://webidl.spec.whatwg.org/#es-dictionary
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DOMException } from "../src/core/errors.ts";
import {
  Algorithm,
  AesCbcParams,
  AesCtrParams,
  AesGcmParams,
  AesKeyGenParams,
  DigestAlgorithm,
  HmacImportParams,
  HmacKeyGenParams,
  normalizeAlgorithm,
} from "../src/crypto/algorithms.ts";
import type { CryptoOperation } from "../src/crypto/algorithms.ts";
import { toCryptoUnsignedInteger } from "../src/crypto/webidl.ts";

function notSupported(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotSupportedError";
}

test("AES normalization produces the operation's typed dictionary", () => {
  for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
    const generated = normalizeAlgorithm({ name: name.toLowerCase(), length: "192" }, "generateKey");
    assert.ok(generated instanceof AesKeyGenParams);
    assert.equal(generated.name, name);
    assert.equal(generated.length, 192);
    for (const operation of ["importKey", "exportKey"] as const) {
      const normalized = normalizeAlgorithm({ name }, operation);
      assert.equal(normalized.constructor, Algorithm);
      assert.deepEqual(Object.keys(normalized), ["name"]);
    }
  }
  const counter = new Uint8Array(16);
  const ctr = normalizeAlgorithm({ name: "aes-ctr", counter, length: 32 }, "encrypt");
  assert.ok(ctr instanceof AesCtrParams);
  assert.equal(ctr.name, "AES-CTR");
  assert.equal(ctr.counter, counter);
  assert.equal(ctr.length, 32);
  const iv = new Uint8Array(16);
  const cbc = normalizeAlgorithm({ name: "aes-cbc", iv }, "decrypt");
  assert.ok(cbc instanceof AesCbcParams);
  assert.equal(cbc.name, "AES-CBC");
  assert.equal(cbc.iv, iv);
  const gcm = normalizeAlgorithm({ name: "aes-gcm", iv }, "encrypt");
  assert.ok(gcm instanceof AesGcmParams);
  assert.equal(gcm.additionalData, undefined);
  assert.equal(gcm.tagLength, undefined);
});

test("HMAC import and generation have distinct typed dictionaries with normalized hashes", () => {
  for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
    const input = { name: "hMaC", hash: { name: hash.toLowerCase() } };
    const generated = normalizeAlgorithm(input, "generateKey");
    const imported = normalizeAlgorithm(input, "importKey");
    assert.ok(generated instanceof HmacKeyGenParams);
    assert.ok(imported instanceof HmacImportParams);
    assert.ok(generated.hash instanceof DigestAlgorithm);
    assert.ok(imported.hash instanceof DigestAlgorithm);
    assert.equal(generated.name, "HMAC");
    assert.equal(generated.hash.name, hash);
    assert.equal(imported.hash.name, hash);
    assert.equal(generated.length, undefined);
    assert.equal(imported.length, undefined);
    assert.notEqual(generated.hash, imported.hash);
    assert.notEqual(generated.hash, input.hash);
  }
});

test("parameterless operations ignore unused algorithm properties", () => {
  const inputs: readonly { name: string; operations: readonly CryptoOperation[] }[] = [
    { name: "HMAC", operations: ["sign", "verify", "exportKey"] },
    { name: "AES-KW", operations: ["wrapKey", "unwrapKey", "importKey", "exportKey"] },
    { name: "AES-CBC", operations: ["importKey", "exportKey"] },
  ];
  for (const { name, operations } of inputs) {
    for (const operation of operations) {
      const normalized = normalizeAlgorithm({
        name,
        get hash() { throw new Error("unused hash"); },
        get length() { throw new Error("unused length"); },
        get iv() { throw new Error("unused iv"); },
      }, operation);
      assert.equal(normalized.constructor, Algorithm);
      assert.deepEqual(Object.keys(normalized), ["name"]);
    }
  }
});

test("GCM dictionary conversion reads inherited name before alphabetical own members", () => {
  const reads: string[] = [];
  const additionalData = new Uint8Array([1]);
  const iv = new Uint8Array(12);
  const normalized = normalizeAlgorithm({
    get tagLength() {
      reads.push("tagLength");
      return { valueOf() { reads.push("tagLength.valueOf"); return 128.9; } };
    },
    get iv() { reads.push("iv"); return iv; },
    get additionalData() { reads.push("additionalData"); return additionalData; },
    get name() { reads.push("name"); return "AES-GCM"; },
  }, "encrypt");
  assert.ok(normalized instanceof AesGcmParams);
  assert.equal(normalized.tagLength, 128);
  assert.deepEqual(reads, ["name", "name", "additionalData", "iv", "tagLength", "tagLength.valueOf"]);
});

test("CTR dictionary conversion reads counter before length and uses the numeric hint", () => {
  const reads: string[] = [];
  const normalized = normalizeAlgorithm({
    get name() { reads.push("name"); return "AES-CTR"; },
    get counter() { reads.push("counter"); return new Uint8Array(16); },
    get length() {
      reads.push("length");
      return { [Symbol.toPrimitive](hint: string) { reads.push(hint); return 64; } };
    },
  }, "encrypt");
  assert.ok(normalized instanceof AesCtrParams);
  assert.equal(normalized.length, 64);
  assert.deepEqual(reads, ["name", "name", "counter", "length", "number"]);
});

test("nested HMAC hash normalization follows the complete outer dictionary conversion", () => {
  for (const operation of ["generateKey", "importKey"] as const) {
    const reads: string[] = [];
    const hash = {
      get name() {
        reads.push("hash.name");
        return { toString() { reads.push("hash.name.toString"); return "sha-256"; } };
      },
    };
    const normalized = normalizeAlgorithm({
      get name() { reads.push("name"); return "HMAC"; },
      get hash() { reads.push("hash"); return hash; },
      get length() {
        reads.push("length");
        return { valueOf() { reads.push("length.valueOf"); return 127.5; } };
      },
    }, operation);
    assert.ok(normalized instanceof HmacKeyGenParams || normalized instanceof HmacImportParams);
    assert.equal(normalized.length, 127);
    assert.deepEqual(reads, [
      "name", "name", "hash", "length", "length.valueOf",
      "hash.name", "hash.name.toString", "hash.name", "hash.name.toString",
    ]);
  }
});

test("the first matching name chooses the dictionary and overwrites the second name", () => {
  let reads = 0;
  const normalized = normalizeAlgorithm({
    get name() { return ++reads === 1 ? "hmac" : "AES-GCM"; },
    hash: "SHA-384",
  }, "importKey");
  assert.ok(normalized instanceof HmacImportParams);
  assert.equal(normalized.name, "HMAC");
  assert.equal(reads, 2);
});

test("unknown operations stop before a second name read or any parameter access", () => {
  let reads = 0;
  assert.throws(() => normalizeAlgorithm({
    get name() { reads++; return "AES-KW"; },
    get iv() { throw new Error("must not read iv"); },
    get length() { throw new Error("must not read length"); },
  }, "encrypt"), notSupported);
  assert.equal(reads, 1);
});

test("second name conversion errors precede parameter getters and preserve the thrown value", () => {
  const failure = new Error("second conversion");
  let reads = 0;
  assert.throws(() => normalizeAlgorithm({
    get name() {
      if (++reads === 2) throw failure;
      return "AES-CBC";
    },
    get iv() { throw new Error("must not read iv"); },
  }, "encrypt"), error => error === failure);
  assert.equal(reads, 2);
  let missingReads = 0;
  assert.throws(() => normalizeAlgorithm({
    get name() { return ++missingReads === 1 ? "AES-CBC" : undefined; },
    get iv() { throw new Error("must not read iv"); },
  }, "encrypt"), TypeError);
});

test("missing members and invalid hash union values stop conversion at their specified position", () => {
  for (const hash of [undefined, Symbol("SHA-256")]) {
    assert.throws(() => normalizeAlgorithm({
      name: "HMAC", hash,
      get length() { throw new Error("length must not be read"); },
    }, "generateKey"), TypeError);
  }
  for (const hash of [null, true, 12, 12n]) {
    let lengthRead = false;
    assert.throws(() => normalizeAlgorithm({
      name: "HMAC", hash,
      get length() { lengthRead = true; return 128; },
    }, "generateKey"), notSupported);
    assert.equal(lengthRead, true);
  }
  assert.throws(() => normalizeAlgorithm({ name: "HMAC", hash: {} }, "importKey"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-CTR", counter: undefined, length: 64 }, "encrypt"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-CTR", counter: new Uint8Array(16) }, "encrypt"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-CBC" }, "encrypt"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-GCM" }, "encrypt"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-KW" }, "generateKey"), TypeError);
});

test("HMAC length conversion errors precede recursive hash-name errors", () => {
  const failure = new Error("length conversion");
  assert.throws(() => normalizeAlgorithm({
    name: "HMAC",
    hash: { get name() { throw new Error("must not normalize hash"); } },
    length: { valueOf() { throw failure; } },
  }, "importKey"), error => error === failure);
  let hashReads = 0;
  const nestedFailure = new Error("nested hash name");
  assert.throws(() => normalizeAlgorithm({
    name: "HMAC",
    hash: { get name() { if (++hashReads === 2) throw nestedFailure; return "SHA-1"; } },
    length: 160,
  }, "importKey"), error => error === nestedFailure);
  assert.equal(hashReads, 2);
});

for (const bits of [8, 16, 32] as const) {
  test("EnforceRange unsigned " + bits + "-bit conversion truncates before checking bounds", () => {
    const maximum = bits === 8 ? 255 : bits === 16 ? 65_535 : 4_294_967_295;
    for (const [input, expected] of [
      [0, 0], [-0, 0], [-0.99, 0], [null, 0], [false, 0], [true, 1],
      ["128.9", 128], [[128], 128], [maximum + 0.5, maximum],
    ] as const) {
      assert.equal(toCryptoUnsignedInteger(input, bits), expected);
    }
    assert.equal(Object.is(toCryptoUnsignedInteger(-0.5, bits), -0), false);
    for (const input of [undefined, NaN, Infinity, -Infinity, -1, maximum + 1, 1n, Symbol("1"), {}]) {
      assert.throws(() => toCryptoUnsignedInteger(input, bits), TypeError);
    }
  });
}

test("normalization leaves algorithm-specific numeric and byte-size policy to the operation", () => {
  for (const length of [0, 129, 255]) {
    const result = normalizeAlgorithm({ name: "AES-CTR", counter: new Uint8Array(0), length }, "encrypt");
    assert.ok(result instanceof AesCtrParams);
    assert.equal(result.length, length);
  }
  for (const length of [0, 129, 65_535]) {
    const result = normalizeAlgorithm({ name: "AES-CBC", length }, "generateKey");
    assert.ok(result instanceof AesKeyGenParams);
    assert.equal(result.length, length);
  }
  for (const tagLength of [0, 31, 65, 255]) {
    const result = normalizeAlgorithm({ name: "AES-GCM", iv: new Uint8Array(0), tagLength }, "encrypt");
    assert.ok(result instanceof AesGcmParams);
    assert.equal(result.tagLength, tagLength);
  }
  for (const operation of ["generateKey", "importKey"] as const) {
    for (const length of [null, 0, 4_294_967_295]) {
      const result = normalizeAlgorithm({ name: "HMAC", hash: "SHA-256", length }, operation);
      assert.ok(result instanceof HmacKeyGenParams || result instanceof HmacImportParams);
      assert.equal(result.length, length ?? 0);
    }
  }
  assert.throws(() => normalizeAlgorithm({ name: "AES-CBC", length: 65_536 }, "generateKey"), TypeError);
  assert.throws(() => normalizeAlgorithm({ name: "AES-GCM", iv: new Uint8Array(12), tagLength: 256 }, "encrypt"), TypeError);
});

test("BufferSource snapshots follow every parameter getter and preserve view bounds", () => {
  const storage = new Uint8Array([0, 1, 2, 3, 4, 5, 0]);
  const iv = new DataView(storage.buffer, 1, 3);
  const additionalData = storage.subarray(4, 6);
  const normalized = normalizeAlgorithm({
    name: "AES-GCM", iv, additionalData,
    get tagLength() {
      storage[1] = 8;
      storage[4] = 9;
      return 128;
    },
  }, "encrypt", true);
  assert.ok(normalized instanceof AesGcmParams);
  assert.deepEqual([...normalized.iv], [8, 2, 3]);
  assert.deepEqual([...normalized.additionalData!], [9, 5]);
  storage.fill(7);
  assert.deepEqual([...normalized.iv], [8, 2, 3]);
  assert.deepEqual([...normalized.additionalData!], [9, 5]);
  assert.equal(normalized.iv.byteOffset, 0);
  assert.equal(normalized.iv.buffer.byteLength, 3);
});

test("default normalization borrows caller bytes until the synchronous operation", () => {
  const iv = new Uint8Array(16);
  const normalized = normalizeAlgorithm({ name: "AES-CBC", iv }, "encrypt");
  assert.ok(normalized instanceof AesCbcParams);
  assert.equal(normalized.iv, iv);
  const snapshot = normalizeAlgorithm({ name: "AES-CBC", iv }, "encrypt", true);
  assert.ok(snapshot instanceof AesCbcParams);
  assert.notEqual(snapshot.iv, iv);
  iv[0] = 42;
  assert.equal(normalized.iv[0], 42);
  assert.equal(snapshot.iv[0], 0);
});

test("normalization snapshots survive the second algorithm's getters in unwrapKey", () => {
  const counter = new Uint8Array(16);
  counter[0] = 3;
  const unwrapAlgorithm = normalizeAlgorithm({ name: "AES-CTR", counter, length: 64 }, "decrypt", true);
  assert.ok(unwrapAlgorithm instanceof AesCtrParams);
  normalizeAlgorithm({
    get name() { counter.fill(9); return "AES-CBC"; },
  }, "importKey");
  assert.equal(unwrapAlgorithm.counter[0], 3);
  assert.equal(counter[0], 9);
});

test("detachment during later dictionary conversion yields an empty parameter snapshot", () => {
  for (const copyBuffers of [false, true]) {
    const counter = new Uint8Array(16);
    const normalized = normalizeAlgorithm({
      name: "AES-CTR", counter,
      get length() { structuredClone(counter.buffer, { transfer: [counter.buffer] }); return 64; },
    }, "encrypt", copyBuffers);
    assert.ok(normalized instanceof AesCtrParams);
    assert.equal(normalized.counter.byteLength, 0);
    const detached = new ArrayBuffer(16);
    const view = new DataView(detached);
    structuredClone(detached, { transfer: [detached] });
    const cbc = normalizeAlgorithm({ name: "AES-CBC", iv: view }, "decrypt", copyBuffers);
    assert.ok(cbc instanceof AesCbcParams);
    assert.equal(cbc.iv.byteLength, 0);
  }
});

test("buffer dictionary conversion rejects shared and resizable sources before later members", () => {
  const shared = new SharedArrayBuffer(16);
  const resizable = new ArrayBuffer(16, { maxByteLength: 32 });
  for (const counter of [shared, new Uint8Array(shared), new DataView(shared), resizable, new Uint8Array(resizable), new DataView(resizable)]) {
    assert.throws(() => normalizeAlgorithm({
      name: "AES-CTR", counter,
      get length() { throw new Error("must not read length"); },
    }, "encrypt"), TypeError);
  }
});

test("cross-realm BufferSources use their intrinsic byte range", { skip: "nts programs have one realm" }, () => {
  const source = runInNewContext("new DataView(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3)") as DataView;
  const result = normalizeAlgorithm({ name: "AES-CBC", iv: source }, "encrypt", true);
  assert.ok(result instanceof AesCbcParams);
  assert.deepEqual([...result.iv], [2, 3, 4]);
});

test("parameter snapshots do not invoke author buffer, species, or iteration properties", { skip: "redefining an intrinsic accessor is something nts programs cannot do" }, () => {
  const iv = new Uint8Array([1, 2, 3]);
  const fail = () => { throw new Error("author property must not be read"); };
  Object.defineProperties(iv, {
    buffer: { get: fail }, byteLength: { get: fail }, byteOffset: { get: fail },
    constructor: { get: fail }, [Symbol.toStringTag]: { get: fail }, [Symbol.iterator]: { get: fail },
  });
  const result = normalizeAlgorithm({ name: "AES-CBC", iv }, "encrypt", true);
  assert.ok(result instanceof AesCbcParams);
  assert.deepEqual([...result.iv], [1, 2, 3]);
});

test("numeric conversion uses captured intrinsics after author coercion runs", { skip: "rule 405266cf7 (call methods plainly): nts programs cannot redefine intrinsic methods, constructors, or prototypes" }, () => {
  const finite = Number.isFinite;
  const truncate = Math.trunc;
  try {
    const value = {
      valueOf() {
        Number.isFinite = () => false;
        Math.trunc = () => { throw new Error("replacement intrinsic"); };
        return 128.75;
      },
    };
    assert.equal(toCryptoUnsignedInteger(value, 16), 128);
  } finally {
    Number.isFinite = finite;
    Math.trunc = truncate;
  }
});

test("algorithm-name matching does not call a replaced String prototype method", { skip: "rule 405266cf7 (call methods plainly): nts programs cannot redefine intrinsic methods, constructors, or prototypes" }, () => {
  const charCodeAt = String.prototype.charCodeAt;
  try {
    const normalized = normalizeAlgorithm({
      get name() {
        String.prototype.charCodeAt = () => { throw new Error("replacement intrinsic"); };
        return "aEs-Kw";
      },
    }, "wrapKey");
    assert.equal(normalized.name, "AES-KW");
  } finally {
    String.prototype.charCodeAt = charCodeAt;
  }
});
