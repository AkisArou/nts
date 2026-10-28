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
  AesDerivedKeyParams,
  AesGcmParams,
  AesKeyGenParams,
  DigestAlgorithm,
  EcdhKeyDeriveParams,
  EcdsaParams,
  EcKeyGenParams,
  EcKeyImportParams,
  HmacImportParams,
  HmacKeyGenParams,
  RsaHashedImportParams,
  RsaHashedKeyGenParams,
  RsaOaepParams,
  RsaPssParams,
  normalizeAlgorithm,
} from "../src/crypto/algorithms.ts";
import type { CryptoOperation } from "../src/crypto/algorithms.ts";
import { createCryptoKey, CryptoKey, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import { toCryptoUnsignedInteger } from "../src/crypto/webidl.ts";
import type { CryptoKeyHandle } from "../src/provider/crypto.ts";

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

test("numeric conversion uses captured intrinsics after author coercion runs", () => {
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

test("algorithm-name matching does not call a replaced String prototype method", () => {
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

// RSA dictionaries: Web Cryptography §§16, 20.3–20.4, 20.8, 21.3 and 22.3.
test("RSA import and generation produce typed dictionaries for every registered hash", () => {
  for (const name of ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"] as const) {
    for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
      const exponent = new Uint8Array([0, 1, 0, 1]);
      const input = { name: name.toLowerCase(), hash: hash.toLowerCase(), modulusLength: "2048.8", publicExponent: exponent };
      const generated = normalizeAlgorithm(input, "generateKey");
      assert.ok(generated instanceof RsaHashedKeyGenParams);
      assert.equal(generated.name, name);
      assert.equal(generated.modulusLength, 2048);
      assert.equal(generated.publicExponent, exponent);
      assert.ok(generated.hash instanceof DigestAlgorithm);
      assert.equal(generated.hash.name, hash);
      const imported = normalizeAlgorithm(input, "importKey");
      assert.ok(imported instanceof RsaHashedImportParams);
      assert.equal(imported.name, name);
      assert.equal(imported.hash.name, hash);
      assert.deepEqual(Object.keys(imported), ["name", "hash"]);
    }
  }
});

test("RSA inherited dictionary members convert before hash, then the nested hash normalizes", () => {
  const reads: string[] = [];
  const exponent = new Uint8Array([1, 0, 1]);
  const normalized = normalizeAlgorithm({
    get name() { reads.push("name"); return "rsa-pss"; },
    get modulusLength() {
      reads.push("modulusLength");
      return { valueOf() { reads.push("modulusLength.valueOf"); return 2048; } };
    },
    get publicExponent() { reads.push("publicExponent"); return exponent; },
    get hash() {
      reads.push("hash");
      return { get name() { reads.push("hash.name"); exponent[2] = 3; return "sha-256"; } };
    },
  }, "generateKey");
  assert.ok(normalized instanceof RsaHashedKeyGenParams);
  assert.equal(normalized.publicExponent, exponent);
  assert.deepEqual([...normalized.publicExponent], [1, 0, 3]);
  assert.deepEqual(reads, ["name", "name", "modulusLength", "modulusLength.valueOf", "publicExponent", "hash", "hash.name", "hash.name"]);
});

test("RSA BigInteger conversion requires a fixed, unshared Uint8Array", () => {
  const shared = new SharedArrayBuffer(3);
  const resizable = new ArrayBuffer(3, { maxByteLength: 8 });
  for (const publicExponent of [
    undefined, null, [1, 0, 1], new ArrayBuffer(3), new DataView(new ArrayBuffer(3)),
    new Uint8ClampedArray([1, 0, 1]), new Int8Array([1, 0, 1]), new Uint16Array([3]),
    new Uint8Array(shared), new Uint8Array(resizable),
  ]) {
    assert.throws(() => normalizeAlgorithm({
      name: "RSA-PSS", modulusLength: 2048, publicExponent,
      get hash() { throw new Error("hash must not be read after invalid exponent"); },
    }, "generateKey"), TypeError);
  }
});

test("RSA BigInteger conversion accepts a foreign-realm Uint8Array", { skip: "nts programs have one realm" }, () => {
  const foreign = runInNewContext("new Uint8Array([9, 1, 0, 1, 8]).subarray(1, 4)") as Uint8Array;
  const normalized = normalizeAlgorithm({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: foreign, hash: "SHA-1" }, "generateKey");
  assert.ok(normalized instanceof RsaHashedKeyGenParams);
  assert.equal(normalized.publicExponent, foreign);
});

test("RSA exponent borrowing uses internal slots despite JavaScript accessor shadows", {
  skip: "nts reads buffer properties as internal slots; ordinary-Node accessor spoofing is not the runtime model",
}, () => {
  const exponent = new Uint8Array([1, 0, 1]);
  const fail = () => { throw new Error("author accessor must not be read"); };
  Object.defineProperties(exponent, {
    buffer: { get: fail }, byteLength: { get: fail }, byteOffset: { get: fail },
    constructor: { get: fail }, [Symbol.toStringTag]: { get: fail }, [Symbol.iterator]: { get: fail },
  });
  const result = normalizeAlgorithm({ name: "RSA-PSS", modulusLength: 2048, publicExponent: exponent, hash: "SHA-256" }, "generateKey");
  assert.ok(result instanceof RsaHashedKeyGenParams);
  assert.equal(result.publicExponent, exponent);
});

test("RSA exponent detachment during nested hash normalization yields an empty integer", () => {
  const buffer = new ArrayBuffer(3);
  const detachedExponent = new Uint8Array(buffer);
  const detached = normalizeAlgorithm({
    name: "RSA-PSS", modulusLength: 2048, publicExponent: detachedExponent,
    hash: { get name() { if (!buffer.detached) structuredClone(buffer, { transfer: [buffer] }); return "SHA-256"; } },
  }, "generateKey");
  assert.ok(detached instanceof RsaHashedKeyGenParams);
  assert.equal(detached.publicExponent.byteLength, 0);
});

test("RSA modulus and PSS salt use unsigned-long EnforceRange without algorithm-policy narrowing", () => {
  for (const [value, expected] of [[0, 0], [-0.5, 0], ["31.9", 31], [null, 0], [4_294_967_295, 4_294_967_295]] as const) {
    const generated = normalizeAlgorithm({ name: "RSA-OAEP", modulusLength: value, publicExponent: new Uint8Array(), hash: "SHA-1" }, "generateKey");
    assert.ok(generated instanceof RsaHashedKeyGenParams);
    assert.equal(generated.modulusLength, expected);
    for (const operation of ["sign", "verify"] as const) {
      const pss = normalizeAlgorithm({ name: "rsa-pss", saltLength: value }, operation);
      assert.ok(pss instanceof RsaPssParams);
      assert.equal(pss.name, "RSA-PSS");
      assert.equal(pss.saltLength, expected);
    }
  }
  for (const value of [undefined, NaN, Infinity, -Infinity, -1, 4_294_967_296, 0n, Symbol("0")]) {
    assert.throws(() => normalizeAlgorithm({
      name: "RSA-PSS", modulusLength: value,
      get publicExponent() { throw new Error("exponent must not be read"); },
    }, "generateKey"), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "RSA-PSS", saltLength: value }, "sign"), TypeError);
  }
});

test("RSA parameterless operations ignore hash, salt and label properties", () => {
  for (const [name, operation] of [
    ["RSASSA-PKCS1-v1_5", "sign"], ["RSASSA-PKCS1-v1_5", "verify"],
    ["RSASSA-PKCS1-v1_5", "exportKey"], ["RSA-PSS", "exportKey"], ["RSA-OAEP", "exportKey"],
  ] as const) {
    const normalized = normalizeAlgorithm({
      name,
      get hash() { throw new Error("unused hash"); },
      get saltLength() { throw new Error("unused salt"); },
      get label() { throw new Error("unused label"); },
      get publicExponent() { throw new Error("unused exponent"); },
    }, operation);
    assert.equal(normalized.constructor, Algorithm);
    assert.equal(normalized.name, name);
  }
});

test("OAEP label is optional and preserves BufferSource view bounds", () => {
  for (const operation of ["encrypt", "decrypt"] as const) {
    const empty = normalizeAlgorithm("rsa-oaep", operation);
    assert.ok(empty instanceof RsaOaepParams);
    assert.equal(empty.label, undefined);
    const storage = new Uint8Array([9, 1, 2, 3, 8]);
    const borrowed = normalizeAlgorithm({ name: "RSA-OAEP", label: storage.subarray(1, 4) }, operation);
    assert.ok(borrowed instanceof RsaOaepParams);
    assert.equal(borrowed.label!.buffer, storage.buffer);
    assert.equal(borrowed.label!.byteOffset, 1);
    assert.equal(borrowed.label!.byteLength, 3);
    const copied = normalizeAlgorithm({ name: "RSA-OAEP", label: new DataView(storage.buffer, 1, 3) }, operation, true);
    assert.ok(copied instanceof RsaOaepParams);
    storage.fill(5);
    assert.deepEqual([...copied.label!], [1, 2, 3]);
    assert.equal(copied.label!.buffer.byteLength, 3);
    assert.throws(() => normalizeAlgorithm({ name: "RSA-OAEP", label: null }, operation), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "RSA-OAEP", label: new Uint8Array(new SharedArrayBuffer(0)) }, operation), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "RSA-OAEP", label: new Uint8Array(new ArrayBuffer(0, { maxByteLength: 1 })) }, operation), TypeError);
  }
});

// EC dictionaries and deriveKey length registration: §§23.3–23.6, 24.3, 27.6, 31.2.
test("EC import and generation retain case-sensitive namedCurve strings for operation policy", () => {
  for (const name of ["ECDSA", "ECDH"] as const) {
    for (const namedCurve of ["P-256", "P-384", "P-521", "p-256", "unknown", "", null, 256]) {
      const generated = normalizeAlgorithm({ name: name.toLowerCase(), namedCurve }, "generateKey");
      const imported = normalizeAlgorithm({ name: name.toLowerCase(), namedCurve }, "importKey");
      assert.ok(generated instanceof EcKeyGenParams);
      assert.ok(imported instanceof EcKeyImportParams);
      assert.equal(generated.name, name);
      assert.equal(generated.namedCurve, String(namedCurve));
      assert.equal(imported.namedCurve, String(namedCurve));
      assert.notEqual(generated, imported);
    }
    for (const operation of ["generateKey", "importKey"] as const) {
      assert.throws(() => normalizeAlgorithm({ name }, operation), TypeError);
      assert.throws(() => normalizeAlgorithm({ name, namedCurve: Symbol("P-256") }, operation), TypeError);
      const reads: string[] = [];
      const normalized = normalizeAlgorithm({
        get name() { reads.push("name"); return name; },
        get namedCurve() {
          reads.push("namedCurve");
          return { [Symbol.toPrimitive](hint: string) { reads.push(hint); return "P-384"; } };
        },
        get hash() { throw new Error("EC key algorithms do not read hash"); },
      }, operation);
      assert.ok(normalized instanceof EcKeyGenParams || normalized instanceof EcKeyImportParams);
      assert.equal(normalized.namedCurve, "P-384");
      assert.deepEqual(reads, ["name", "name", "namedCurve", "string"]);
    }
  }
});

test("ECDSA selects and normalizes a hash separately for each signature operation", () => {
  for (const operation of ["sign", "verify"] as const) {
    for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
      const reads: string[] = [];
      const normalized = normalizeAlgorithm({
        get name() { reads.push("name"); return "eCdSa"; },
        get hash() {
          reads.push("hash");
          return { get name() { reads.push("hash.name"); return hash.toLowerCase(); } };
        },
        get namedCurve() { throw new Error("a signature reads its curve from the key"); },
      }, operation);
      assert.ok(normalized instanceof EcdsaParams);
      assert.ok(normalized.hash instanceof DigestAlgorithm);
      assert.equal(normalized.name, "ECDSA");
      assert.equal(normalized.hash.name, hash);
      assert.deepEqual(reads, ["name", "name", "hash", "hash.name", "hash.name"]);
    }
    assert.throws(() => normalizeAlgorithm("ECDSA", operation), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "ECDSA", hash: undefined }, operation), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "ECDSA", hash: Symbol("SHA-256") }, operation), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "ECDSA", hash: "SHA-3" }, operation), notSupported);
  }
});

test("ECDH public dictionary conversion checks only the CryptoKey brand and preserves its identity", () => {
  for (const type of ["public", "private", "secret"] as const) {
    const publicKey = createCryptoKey(type, false, new KeyAlgorithm("not ECDH"), [], {} as CryptoKeyHandle);
    const reads: string[] = [];
    const normalized = normalizeAlgorithm({
      get name() { reads.push("name"); return "ecdh"; },
      get public() { reads.push("public"); return publicKey; },
      get namedCurve() { throw new Error("ECDH does not read a namedCurve parameter"); },
      get hash() { throw new Error("ECDH does not read a hash parameter"); },
    }, "deriveBits");
    assert.ok(normalized instanceof EcdhKeyDeriveParams);
    assert.equal(normalized.name, "ECDH");
    assert.equal(normalized.public, publicKey);
    assert.deepEqual(reads, ["name", "name", "public"]);
  }
  for (const publicKey of [undefined, null, false, "key", {}, Object.create(CryptoKey.prototype)]) {
    assert.throws(() => normalizeAlgorithm({ name: "ECDH", public: publicKey }, "deriveBits"), TypeError);
  }
  const error = new Error("peer getter");
  assert.throws(() => normalizeAlgorithm({ name: "ECDH", get public() { throw error; } }, "deriveBits"), value => value === error);
});

test("EC export dictionaries ignore every operation-specific member", () => {
  for (const name of ["ECDSA", "ECDH"] as const) {
    const normalized = normalizeAlgorithm({
      name,
      get namedCurve() { throw new Error("unused curve"); },
      get hash() { throw new Error("unused hash"); },
      get public() { throw new Error("unused peer"); },
    }, "exportKey");
    assert.equal(normalized.constructor, Algorithm);
    assert.deepEqual(Object.keys(normalized), ["name"]);
  }
});

test("deriveKey length registration uses AES derived and HMAC import dictionaries", () => {
  for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
    for (const length of [0, 128, 192, 256, 65_535]) {
      const reads: string[] = [];
      const normalized = normalizeAlgorithm({
        get name() { reads.push("name"); return name.toLowerCase(); },
        get length() {
          reads.push("length");
          return { valueOf() { reads.push("length.valueOf"); return length + 0.5; } };
        },
        get iv() { throw new Error("derived AES keys do not read IVs"); },
      }, "get key length");
      assert.ok(normalized instanceof AesDerivedKeyParams);
      assert.equal(normalized.name, name);
      assert.equal(normalized.length, length);
      assert.deepEqual(reads, ["name", "name", "length", "length.valueOf"]);
    }
    for (const length of [undefined, -1, 65_536, NaN, 1n]) {
      assert.throws(() => normalizeAlgorithm({ name, length }, "get key length"), TypeError);
    }
  }
  for (const length of [undefined, 0, 1, 4_294_967_295]) {
    const reads: string[] = [];
    const normalized = normalizeAlgorithm({
      get name() { reads.push("name"); return "hmac"; },
      get hash() { reads.push("hash"); return { get name() { reads.push("hash.name"); return "sha-512"; } }; },
      get length() { reads.push("length"); return length; },
    }, "get key length");
    assert.ok(normalized instanceof HmacImportParams);
    assert.equal(normalized.length, length);
    assert.equal(normalized.hash.name, "SHA-512");
    assert.deepEqual(reads, ["name", "name", "hash", "length", "hash.name", "hash.name"]);
  }
});
