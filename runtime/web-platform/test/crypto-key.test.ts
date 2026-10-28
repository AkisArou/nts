// Web Cryptography Level 2, §§9, 12, 13.3–13.4: internal slots and their caches.
// https://w3c.github.io/webcrypto/#cryptokey-interface
import assert from "node:assert/strict";
import test from "node:test";

import {
  CryptoKey,
  KeyAlgorithm,
  createCryptoKey,
  getCryptoKeySlots,
} from "../src/crypto/crypto-key.ts";
import type { KeyType, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoKeyHandle } from "../src/provider/crypto.ts";

// The fixture tests the Web API's custody of an opaque handle, not a primitive.
const handle = {} as CryptoKeyHandle;

function key(
  type: KeyType = "secret",
  extractable = false,
  usages: readonly KeyUsage[] = ["sign"],
): CryptoKey {
  return createCryptoKey(type, extractable, new KeyAlgorithm("HMAC"), usages, handle);
}

test("CryptoKey construction is reserved to shared cryptographic algorithms", () => {
  assert.equal(CryptoKey.length, 0);
  assert.throws(() => new CryptoKey(), TypeError);
  assert.throws(() => new CryptoKey(Symbol("CryptoKey construction")), TypeError);
  class ForgedKey extends CryptoKey {}
  assert.throws(() => new ForgedKey(), TypeError);
  assert.ok(key() instanceof CryptoKey);
});

for (const type of ["public", "private", "secret"] as const) {
  for (const extractable of [false, true]) {
    test("CryptoKey exposes its " + type + " type and extractable=" + extractable, () => {
      const actual = key(type, extractable);
      assert.equal(actual.type, type);
      assert.equal(actual.extractable, extractable);
      assert.equal(getCryptoKeySlots(actual).handle, handle);
    });
  }
}

test("CryptoKey attribute getters have no setters", () => {
  for (const name of ["type", "extractable", "algorithm", "usages"]) {
    const descriptor = Object.getOwnPropertyDescriptor(CryptoKey.prototype, name);
    assert.equal(typeof descriptor?.get, "function");
    assert.equal(descriptor?.set, undefined);
  }
});

test("CryptoKey makes each mutable ECMAScript attribute cache once", () => {
  const actual = key();
  const algorithm = actual.algorithm;
  const usages = actual.usages;
  assert.equal(actual.algorithm, algorithm);
  assert.equal(actual.usages, usages);
  assert.equal(Object.getPrototypeOf(algorithm), Object.prototype);
  assert.equal(Object.getPrototypeOf(usages), Array.prototype);
  assert.deepEqual(algorithm, { name: "HMAC" });
  assert.deepEqual(usages, ["sign"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(algorithm, "name"), {
    value: "HMAC", writable: true, enumerable: true, configurable: true,
  });

  algorithm.name = "AES-GCM";
  usages.push("encrypt");
  assert.equal(actual.algorithm, algorithm);
  assert.equal(actual.usages, usages);
  assert.deepEqual(actual.algorithm, { name: "AES-GCM" });
  assert.deepEqual(actual.usages, ["sign", "encrypt"]);
  assert.equal(getCryptoKeySlots(actual).algorithm.name, "HMAC");
  assert.deepEqual(getCryptoKeySlots(actual).usages, ["sign"]);
});

test("CryptoKey snapshots the supplied algorithm and usages before exposing them", () => {
  const algorithm = new KeyAlgorithm("HMAC");
  const usages: KeyUsage[] = ["sign", "verify"];
  const actual = createCryptoKey("secret", true, algorithm, usages, handle);
  assert.notEqual(getCryptoKeySlots(actual).algorithm, algorithm);
  assert.notEqual(getCryptoKeySlots(actual).usages, usages);
  assert.notEqual(actual.usages, usages);
  assert.notEqual(actual.usages, getCryptoKeySlots(actual).usages);
  (algorithm as { name: string }).name = "other";
  usages[0] = "encrypt";
  usages.length = 1;
  assert.equal(actual.algorithm.name, "HMAC");
  assert.equal(getCryptoKeySlots(actual).algorithm.name, "HMAC");
  assert.deepEqual(actual.usages, ["sign", "verify"]);
  assert.deepEqual(getCryptoKeySlots(actual).usages, ["sign", "verify"]);
});

test("CryptoKey caches are distinct even when two keys refer to one handle", () => {
  const first = key();
  const second = key();
  assert.notEqual(first, second);
  assert.notEqual(first.algorithm, second.algorithm);
  assert.notEqual(first.usages, second.usages);
  assert.notEqual(getCryptoKeySlots(first), getCryptoKeySlots(second));
  first.algorithm.name = "changed";
  first.usages.length = 0;
  assert.deepEqual(second.algorithm, { name: "HMAC" });
  assert.deepEqual(second.usages, ["sign"]);
});

test("CryptoKey reflects every recognized usage without inventing permissions", () => {
  const usages: readonly KeyUsage[] = [
    "encrypt", "decrypt", "sign", "verify", "deriveKey", "deriveBits", "wrapKey", "unwrapKey",
  ];
  for (const usage of usages) {
    const actual = key("secret", false, [usage]);
    assert.deepEqual(actual.usages, [usage]);
    assert.deepEqual(getCryptoKeySlots(actual).usages, [usage]);
  }
  const publicKey = key("public", true, []);
  assert.deepEqual(publicKey.usages, []);
  assert.equal(publicKey.usages, publicKey.usages);
});

test("CryptoKey never places its slots or handle on the public instance", () => {
  const actual = key();
  assert.deepEqual(Object.getOwnPropertyNames(actual), []);
  assert.deepEqual(Object.getOwnPropertySymbols(actual), []);
  assert.equal(JSON.stringify(actual), "{}");
  assert.deepEqual(Object.getOwnPropertyNames(CryptoKey.prototype).sort(), [
    "algorithm", "constructor", "extractable", "type", "usages",
  ]);
  for (const name of ["handle", "slots", "algorithmCached", "usagesCached", "constructorToken"]) {
    assert.equal(name in actual, false);
  }
});

test("CryptoKey internal reads ignore public properties and their getters", () => {
  const actual = key();
  const reads: string[] = [];
  for (const name of ["type", "extractable", "algorithm", "usages", "handle", "slots"]) {
    Object.defineProperty(actual, name, {
      get() {
        reads.push(name);
        throw new Error("author getter must not run");
      },
    });
  }
  const slots = getCryptoKeySlots(actual);
  assert.equal(slots.type, "secret");
  assert.equal(slots.extractable, false);
  assert.equal(slots.algorithm.name, "HMAC");
  assert.deepEqual(slots.usages, ["sign"]);
  assert.equal(slots.handle, handle);
  for (const name of ["type", "extractable", "algorithm", "usages"]) {
    const getter = Object.getOwnPropertyDescriptor(CryptoKey.prototype, name)?.get;
    assert.ok(getter);
    assert.doesNotThrow(() => getter.call(actual));
  }
  assert.deepEqual(reads, []);
});

test("CryptoKey rejects invalid receivers and prototype forgeries", () => {
  const actual = key();
  const invalid: unknown[] = [
    undefined, null, false, 1, "key", Symbol("key"), () => {}, {},
    CryptoKey.prototype, Object.create(CryptoKey.prototype), Object.create(actual),
    { type: "secret", extractable: false, algorithm: { name: "HMAC" }, usages: ["sign"], handle },
    new Proxy(actual, {}),
  ];
  for (const value of invalid) {
    assert.throws(() => getCryptoKeySlots(value), TypeError);
    for (const name of ["type", "extractable", "algorithm", "usages"]) {
      const getter = Object.getOwnPropertyDescriptor(CryptoKey.prototype, name)?.get;
      assert.ok(getter);
      assert.throws(() => getter.call(value), TypeError);
    }
  }
});
