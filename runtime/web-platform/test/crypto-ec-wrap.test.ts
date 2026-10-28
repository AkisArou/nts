// Web Cryptography §§14.3.11–12, 23–24, 27–30: EC key wrapping uses the
// existing shared export/import and JSON policy, never a second crypto adapter.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoNamedCurve } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { ecPrivateJwk, ecPublicJwk, ecdsaMessage, ecdsaSignature } from "./ec-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { rsaPkcs8, rsaSpki } from "./rsa-fixtures.ts";

function fixture() {
  const scheduler = new VirtualScheduler();
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { bytes.fill(1); } }, new NodeCryptoProvider(), scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function ec(curve: CryptoNamedCurve, name: "ECDSA" | "ECDH", type: "private" | "public") {
    const usages: KeyUsage[] = name === "ECDSA" ? [type === "private" ? "sign" : "verify"]
      : type === "private" ? ["deriveBits", "deriveKey"] : [];
    return settle(subtle.importKey("jwk", type === "private" ? ecPrivateJwk(curve) : ecPublicJwk(curve),
      { name, namedCurve: curve }, true, usages));
  }
  async function wrapping(name = "AES-GCM") {
    return settle(subtle.importKey("raw", new Uint8Array(16).fill(0x67), name, false, ["wrapKey", "unwrapKey"]));
  }
  return { subtle, settle, ec, wrapping };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

for (const curve of ["P-256", "P-384", "P-521"] as const) {
  for (const name of ["ECDSA", "ECDH"] as const) {
    for (const [type, format] of [["public", "raw"], ["public", "spki"], ["private", "pkcs8"], ["public", "jwk"], ["private", "jwk"]] as const) {
      test(`AES-GCM wraps and unwraps ${curve} ${name} ${type} ${format}`, async () => {
        const f = fixture();
        const key = await f.ec(curve, name, type);
        const wrapping = await f.wrapping();
        const original = await f.settle(f.subtle.exportKey(format, key));
        const algorithm = { name: "AES-GCM", iv: new Uint8Array(12), additionalData: new Uint8Array([2, 7, 1, 8]) };
        const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm));
        const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, algorithm,
          { name, namedCurve: curve }, true, key.usages));
        assert.equal(restored.type, type);
        assert.deepEqual(restored.algorithm, key.algorithm);
        assert.deepEqual(restored.usages, key.usages);
        assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), original);
        if (name === "ECDSA") {
          const verifyKey = type === "public" ? restored : await f.ec(curve, name, "public");
          const signature = type === "public" ? ecdsaSignature(curve, "SHA-256")
            : await f.settle(f.subtle.sign({ name, hash: "SHA-256" }, restored, ecdsaMessage()));
          assert.equal(await f.settle(f.subtle.verify({ name, hash: "SHA-256" }, verifyKey, signature, ecdsaMessage())), true);
        } else {
          const publicKey = type === "public" ? restored : await f.ec(curve, name, "public");
          const privateKey = type === "private" ? restored : await f.ec(curve, name, "private");
          const bits = await f.settle(f.subtle.deriveBits({ name, public: publicKey }, privateKey));
          const originalPublic = type === "public" ? key : publicKey;
          const originalPrivate = type === "private" ? key : privateKey;
          assert.deepEqual(bits, await f.settle(f.subtle.deriveBits({ name, public: originalPublic }, originalPrivate)));
        }
      });
    }
  }

  test(`AES-KW pads ${curve} EC JWK JSON and restores both key types`, async () => {
    const f = fixture();
    const wrapping = await f.wrapping("AES-KW");
    for (const type of ["public", "private"] as const) {
      const key = await f.ec(curve, "ECDSA", type);
      const wrapped = await f.settle(f.subtle.wrapKey("jwk", key, wrapping, "AES-KW"));
      assert.equal(wrapped.byteLength % 8, 0);
      const restored = await f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, "AES-KW",
        { name: "ECDSA", namedCurve: curve }, true, key.usages));
      assert.deepEqual(await f.settle(f.subtle.exportKey("jwk", restored)), await f.settle(f.subtle.exportKey("jwk", key)));
    }
    const raw = await f.ec(curve, "ECDSA", "public");
    await assert.rejects(f.settle(f.subtle.wrapKey("raw", raw, wrapping, "AES-KW")), dom("OperationError"));
  });
}

test("RSA-OAEP wraps the largest supported raw EC public key", async () => {
  const f = fixture();
  const publicKey = await f.settle(f.subtle.importKey("spki", rsaSpki(), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]));
  const privateKey = await f.settle(f.subtle.importKey("pkcs8", rsaPkcs8(), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]));
  const key = await f.ec("P-521", "ECDSA", "public");
  const wrapped = await f.settle(f.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP"));
  const restored = await f.settle(f.subtle.unwrapKey("raw", wrapped, privateKey, "RSA-OAEP",
    { name: "ECDSA", namedCurve: "P-521" }, true, ["verify"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", restored)), await f.settle(f.subtle.exportKey("raw", key)));
});

test("EC unwrap enforces curve and JWK usage policy after authenticated decryption", async () => {
  const f = fixture();
  const wrapping = await f.wrapping();
  const key = await f.ec("P-256", "ECDSA", "private");
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
  const wrapped = new Uint8Array(await f.settle(f.subtle.wrapKey("jwk", key, wrapping, algorithm)));
  await assert.rejects(f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm,
    { name: "ECDSA", namedCurve: "P-384" }, true, ["sign"])), dom("DataError"));
  await assert.rejects(f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm,
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"])), dom("DataError"));
  wrapped[0]! ^= 1;
  await assert.rejects(f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm,
    { name: "ECDSA", namedCurve: "unsupported" }, true, ["sign"])), dom("OperationError"));
});

test("EC unwrap snapshots cipher parameters before reading namedCurve", async () => {
  const f = fixture();
  const wrapping = await f.wrapping();
  const key = await f.ec("P-256", "ECDSA", "public");
  const iv = new Uint8Array(12).fill(0x1a);
  const additionalData = new Uint8Array([1, 2, 3]);
  const algorithm = { name: "AES-GCM", iv, additionalData };
  const wrapped = await f.settle(f.subtle.wrapKey("spki", key, wrapping, algorithm));
  const restored = await f.settle(f.subtle.unwrapKey("spki", wrapped, wrapping, algorithm, {
    name: "ECDSA",
    get namedCurve() { iv.fill(0); additionalData.fill(0); return "P-256"; },
  }, true, ["verify"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("spki", restored)), await f.settle(f.subtle.exportKey("spki", key)));
});
