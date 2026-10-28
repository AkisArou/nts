// Web Cryptography Level 2 §§18.4.2–18.4.4 and 32.2:
// https://w3c.github.io/webcrypto/#algorithm-normalization
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import {
  Algorithm,
  DigestAlgorithm,
  normalizeAlgorithm,
  supportsCryptoOperation,
  toAlgorithmIdentifier,
} from "../src/crypto/algorithms.ts";
import type { CryptoOperation } from "../src/crypto/algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { CryptoKeyHandle } from "../src/provider/crypto.ts";

const hashes = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const otherOperations: readonly CryptoOperation[] = [
  "encrypt", "decrypt", "sign", "verify", "generateKey", "deriveBits",
  "importKey", "exportKey", "wrapKey", "unwrapKey", "get key length",
];

for (const operation of otherOperations) {
  test("the SHA registry does not register " + operation, () => {
    for (const name of hashes) {
      let reads = 0;
      assert.throws(
        () => normalizeAlgorithm({ get name() { reads++; return name; } }, operation),
        (error: unknown) => error instanceof DOMException && error.name === "NotSupportedError",
      );
      assert.equal(reads, 1, "unsupported operations stop before the second dictionary conversion");
    }
  });
}

test("normalization produces a new typed dictionary for each operation", () => {
  for (const name of hashes) {
    const input = new Algorithm(name.toLowerCase());
    const first = normalizeAlgorithm(input, "digest");
    const second = normalizeAlgorithm(input, "digest");
    assert.ok(first instanceof DigestAlgorithm);
    assert.equal(first.name, name);
    assert.notEqual(first, second);
    assert.equal(input.name, name.toLowerCase());
    assert.deepEqual(Object.keys(first), ["name"]);
  }
});

test("algorithm matching is ASCII-only and does not trim or accept aliases", () => {
  for (const name of ["ſHA-1", "ＳＨＡ-256", " SHA-256", "SHA-256 ", "SHA256", "sha_256", "SHA-256\0"]) {
    assert.throws(
      () => normalizeAlgorithm(name, "digest"),
      (error: unknown) => error instanceof DOMException && error.name === "NotSupportedError",
    );
  }
});

test("AlgorithmIdentifier preserves objects without consulting coercion hooks", () => {
  const input = { [Symbol.toPrimitive]() { throw new Error("must not coerce an object"); } };
  assert.equal(toAlgorithmIdentifier(input), input);
  const callable = () => {};
  assert.equal(toAlgorithmIdentifier(callable), callable);
  assert.equal(toAlgorithmIdentifier(null), "null");
  assert.equal(toAlgorithmIdentifier(undefined), "undefined");
  assert.equal(toAlgorithmIdentifier(12n), "12");
  assert.throws(() => toAlgorithmIdentifier(Symbol("SHA-256")), TypeError);
});

const allOperations: readonly CryptoOperation[] = ["digest", ...otherOperations];
const keyRegistrations: readonly { name: string; operations: readonly CryptoOperation[] }[] = [
  { name: "AES-CTR", operations: ["encrypt", "decrypt", "generateKey", "importKey", "exportKey", "get key length"] },
  { name: "AES-CBC", operations: ["encrypt", "decrypt", "generateKey", "importKey", "exportKey", "get key length"] },
  { name: "AES-GCM", operations: ["encrypt", "decrypt", "generateKey", "importKey", "exportKey", "get key length"] },
  { name: "AES-KW", operations: ["wrapKey", "unwrapKey", "generateKey", "importKey", "exportKey", "get key length"] },
  { name: "HMAC", operations: ["sign", "verify", "generateKey", "importKey", "exportKey", "get key length"] },
  { name: "RSASSA-PKCS1-v1_5", operations: ["sign", "verify", "generateKey", "importKey", "exportKey"] },
  { name: "RSA-PSS", operations: ["sign", "verify", "generateKey", "importKey", "exportKey"] },
  { name: "RSA-OAEP", operations: ["encrypt", "decrypt", "generateKey", "importKey", "exportKey"] },
  { name: "ECDSA", operations: ["sign", "verify", "generateKey", "importKey", "exportKey"] },
  { name: "ECDH", operations: ["deriveBits", "generateKey", "importKey", "exportKey"] },
  { name: "Ed25519", operations: ["sign", "verify", "generateKey", "importKey", "exportKey"] },
  { name: "X25519", operations: ["deriveBits", "generateKey", "importKey", "exportKey"] },
  { name: "Ed448", operations: ["sign", "verify", "generateKey", "importKey", "exportKey"] },
  { name: "X448", operations: ["deriveBits", "generateKey", "importKey", "exportKey"] },
  { name: "HKDF", operations: ["deriveBits", "importKey", "get key length"] },
  { name: "PBKDF2", operations: ["deriveBits", "importKey", "get key length"] },
];

for (const registration of keyRegistrations) {
  test(registration.name + " registers exactly the implemented specification operations", () => {
    for (const operation of allOperations) {
      let reads = 0;
      const input = {
        get name() { reads++; return registration.name.toLowerCase(); },
        counter: new Uint8Array(16),
        iv: new Uint8Array(16),
        length: 128,
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        saltLength: 32,
        salt: new Uint8Array([1, 2, 3]),
        info: new Uint8Array([4, 5, 6]),
        iterations: 1,
        namedCurve: "P-256",
        public: createCryptoKey("public", true, new KeyAlgorithm("ECDH"), [], {} as CryptoKeyHandle),
      };
      const supported = registration.operations.includes(operation);
      assert.equal(supportsCryptoOperation(registration.name.toLowerCase(), operation), supported);
      if (supported) {
        assert.equal(normalizeAlgorithm(input, operation).name, registration.name);
        assert.equal(reads, 2);
      } else {
        assert.throws(
          () => normalizeAlgorithm(input, operation),
          (error: unknown) => error instanceof DOMException && error.name === "NotSupportedError",
        );
        assert.equal(reads, 1);
      }
    }
  });
}

test("future families and Modern Algorithms remain unregistered", () => {
  for (const name of ["AES-OCB", "KMAC128"]) {
    for (const operation of allOperations) {
      assert.equal(supportsCryptoOperation(name, operation), false);
    }
  }
});
