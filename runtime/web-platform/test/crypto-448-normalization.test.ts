// Secure Curves §§4.2, 6.2–6.3: https://wicg.github.io/webcrypto-secure-curves/
// Web Cryptography §18.4.4 and Web IDL §3.2.17 define dictionary conversion.
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Algorithm, EcdhKeyDeriveParams, Ed448Params, normalizeAlgorithm } from "../src/crypto/algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { CryptoKeyHandle } from "../src/provider/crypto.ts";

for (const operation of ["sign", "verify"] as const) {
  test("Ed448 " + operation + " normalizes optional context without applying operation length policy", () => {
    const absent = normalizeAlgorithm("eD448", operation);
    assert.ok(absent instanceof Ed448Params);
    assert.equal(absent.name, "Ed448");
    assert.equal(absent.context, undefined);
    assert.deepEqual(Object.keys(absent), ["name", "context"]);
    for (const length of [0, 1, 255, 256]) {
      const context = new Uint8Array(length);
      const normalized = normalizeAlgorithm({ name: "ed448", context }, operation);
      assert.ok(normalized instanceof Ed448Params);
      assert.equal(normalized.context, context);
      assert.equal(normalized.context.byteLength, length);
    }
  });

  test("Ed448 " + operation + " reads name twice then context once and ignores hash", () => {
    const reads: string[] = [];
    const normalized = normalizeAlgorithm({
      get context() { reads.push("context"); return new Uint8Array([1, 2]); },
      get name() {
        reads.push("name");
        return { toString() { reads.push("name.toString"); return "eD448"; } };
      },
      get hash() { throw new Error("Ed448 has no external hash"); },
    }, operation);
    assert.ok(normalized instanceof Ed448Params);
    assert.deepEqual(reads, ["name", "name.toString", "name", "name.toString", "context"]);
  });

  test("Ed448 " + operation + " rejects invalid contexts during BufferSource conversion", () => {
    const shared = new SharedArrayBuffer(3);
    const resizable = new ArrayBuffer(3, { maxByteLength: 8 });
    for (const context of [
      null, true, 1, "context", [], {}, shared, new Uint8Array(shared), new DataView(shared),
      resizable, new Uint8Array(resizable), new DataView(resizable),
    ]) {
      assert.throws(() => normalizeAlgorithm({ name: "Ed448", context }, operation), TypeError);
    }
  });

  test("Ed448 " + operation + " borrows exact view bounds or takes an independent snapshot", () => {
    const storage = new Uint8Array([9, 1, 2, 3, 8]);
    const context = new DataView(storage.buffer, 1, 3);
    const borrowed = normalizeAlgorithm({ name: "Ed448", context }, operation);
    const copied = normalizeAlgorithm({ name: "Ed448", context }, operation, true);
    assert.ok(borrowed instanceof Ed448Params && copied instanceof Ed448Params);
    assert.equal(borrowed.context!.buffer, storage.buffer);
    assert.equal(borrowed.context!.byteOffset, 1);
    assert.equal(borrowed.context!.byteLength, 3);
    assert.equal(copied.context!.byteOffset, 0);
    assert.equal(copied.context!.buffer.byteLength, 3);
    storage.fill(7);
    assert.deepEqual([...borrowed.context!], [7, 7, 7]);
    assert.deepEqual([...copied.context!], [1, 2, 3]);
  });

  test("Ed448 " + operation + " accepts detached contexts", () => {
    const context = new DataView(new ArrayBuffer(2));
    structuredClone(context.buffer, { transfer: [context.buffer] });
    for (const copyBuffers of [false, true]) {
      const detached = normalizeAlgorithm({ name: "Ed448", context }, operation, copyBuffers);
      assert.ok(detached instanceof Ed448Params);
      assert.equal(detached.context!.byteLength, 0);
    }
  });

  test("Ed448 " + operation + " accepts foreign-realm contexts", { skip: "nts programs have one realm" }, () => {
    const foreign = runInNewContext("new DataView(new Uint8Array([9, 1, 2, 8]).buffer, 1, 2)") as DataView;
    for (const copyBuffers of [false, true]) {
      const normalized = normalizeAlgorithm({ name: "Ed448", context: foreign }, operation, copyBuffers);
      assert.ok(normalized instanceof Ed448Params);
      assert.deepEqual([...normalized.context!], [1, 2]);
    }
  });
}

test("Ed448 keeps the first matching algorithm name and preserves context getter exceptions", () => {
  let names = 0;
  const normalized = normalizeAlgorithm({
    get name() { return ++names === 1 ? "Ed448" : "X448"; },
    context: new Uint8Array([1]),
    get public() { throw new Error("must not read peer"); },
  }, "sign");
  assert.ok(normalized instanceof Ed448Params);
  assert.equal(normalized.name, "Ed448");
  const failure = new Error("context getter");
  assert.throws(() => normalizeAlgorithm({ name: "Ed448", get context() { throw failure; } }, "verify"), error => error === failure);
  names = 0;
  assert.throws(() => normalizeAlgorithm({
    get name() { if (++names === 2) throw failure; return "Ed448"; },
    get context() { throw new Error("must not read context"); },
  }, "sign"), error => error === failure);
});

test("448 key lifecycle dictionaries ignore signature, agreement and hash parameters", () => {
  for (const name of ["Ed448", "X448"]) {
    for (const operation of ["generateKey", "importKey", "exportKey"] as const) {
      const normalized = normalizeAlgorithm({
        name,
        get context() { throw new Error("unused context"); },
        get public() { throw new Error("unused peer"); },
        get hash() { throw new Error("unused hash"); },
        get namedCurve() { throw new Error("unused named curve"); },
      }, operation);
      assert.equal(normalized.constructor, Algorithm);
      assert.deepEqual(Object.keys(normalized), ["name"]);
    }
  }
});

test("X448 reuses the agreement dictionary and preserves the branded peer identity", () => {
  const peer = createCryptoKey("public", false, new KeyAlgorithm("X448"), [], {} as CryptoKeyHandle);
  const reads: string[] = [];
  const normalized = normalizeAlgorithm({
    get name() { reads.push("name"); return "x448"; },
    get public() { reads.push("public"); return peer; },
    get context() { throw new Error("unused context"); },
    get hash() { throw new Error("unused hash"); },
    get namedCurve() { throw new Error("unused named curve"); },
  }, "deriveBits", true);
  assert.ok(normalized instanceof EcdhKeyDeriveParams);
  assert.equal(normalized.name, "X448");
  assert.equal(normalized.public, peer);
  assert.deepEqual(Object.keys(normalized), ["name", "public"]);
  assert.deepEqual(reads, ["name", "name", "public"]);
});

test("X448 requires a CryptoKey public member but leaves key policy to the operation", () => {
  for (const value of [undefined, null, {}, { type: "public", algorithm: { name: "X448" } }, new Uint8Array(56)]) {
    assert.throws(() => normalizeAlgorithm({ name: "X448", public: value }, "deriveBits"), TypeError);
  }
  const privatePeer = createCryptoKey("private", true, new KeyAlgorithm("Ed448"), ["sign"], {} as CryptoKeyHandle);
  const normalized = normalizeAlgorithm({ name: "X448", public: privatePeer }, "deriveBits");
  assert.ok(normalized instanceof EcdhKeyDeriveParams);
  assert.equal(normalized.public, privatePeer);
  const failure = new Error("peer getter");
  assert.throws(() => normalizeAlgorithm({ name: "X448", get public() { throw failure; } }, "deriveBits"), error => error === failure);
});
