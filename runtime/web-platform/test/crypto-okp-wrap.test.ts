// Web Cryptography §§14.3.11–12, 25–26 and AES wrapping operations.
// Tests use this package's Crypto over native primitives, never Node WebCrypto.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import {
  ed25519Message, ed25519Signature, okpPrivateJwk, okpPublicJwk,
  x25519PrivateJwk, x25519PublicJwk, x25519Secret,
} from "./okp-fixtures.ts";

function fixture() {
  const scheduler = new VirtualScheduler();
  const subtle = new Crypto({ fill(bytes: Uint8Array): void { bytes.fill(1); } }, new NodeCryptoProvider(), scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: "Ed25519" | "X25519", type: "public" | "private") {
    const usages: KeyUsage[] = name === "Ed25519" ? [type === "private" ? "sign" : "verify"]
      : type === "private" ? ["deriveKey", "deriveBits"] : [];
    return settle(subtle.importKey("jwk", type === "private" ? okpPrivateJwk(name) : okpPublicJwk(name), name, true, usages));
  }
  async function wrapping(name: string) {
    return settle(subtle.importKey("raw", new Uint8Array(16).fill(0x73), name, false, ["wrapKey", "unwrapKey"]));
  }
  return { subtle, settle, key, wrapping };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

for (const name of ["Ed25519", "X25519"] as const) {
  for (const [type, format] of [["public", "raw"], ["public", "spki"], ["private", "pkcs8"], ["public", "jwk"], ["private", "jwk"]] as const) {
    test(`AES-GCM wraps ${name} ${type} ${format} and restores usable key material`, async () => {
      const f = fixture();
      const key = await f.key(name, type);
      const wrapping = await f.wrapping("AES-GCM");
      const algorithm = { name: "AES-GCM", iv: new Uint8Array(12), additionalData: new Uint8Array([1, 6, 1, 8]) };
      const original = await f.settle(f.subtle.exportKey(format, key));
      const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm));
      const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, algorithm, name, true, key.usages));
      assert.deepEqual(restored.algorithm, { name });
      assert.equal(restored.type, type);
      assert.deepEqual(restored.usages, key.usages);
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), original);
      if (name === "Ed25519") {
        if (type === "private") {
          assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign(name, restored, ed25519Message()))), ed25519Signature());
        } else {
          assert.equal(await f.settle(f.subtle.verify(name, restored, ed25519Signature(), ed25519Message())), true);
        }
      } else {
        const peer = await f.settle(f.subtle.importKey("jwk", type === "private" ? x25519PublicJwk("bob") : x25519PrivateJwk("bob"),
          name, false, type === "private" ? [] : ["deriveBits"]));
        const bits = await f.settle(f.subtle.deriveBits({ name, public: type === "public" ? restored : peer }, type === "private" ? restored : peer));
        assert.deepEqual(new Uint8Array(bits), x25519Secret());
      }
    });
  }

  for (const [type, format] of [["public", "raw"], ["private", "pkcs8"], ["public", "jwk"], ["private", "jwk"]] as const) {
    test(`AES-KW wraps the ${name} ${type} ${format} encoding`, async () => {
      const f = fixture();
      const key = await f.key(name, type);
      const wrapping = await f.wrapping("AES-KW");
      const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, "AES-KW"));
      assert.equal(wrapped.byteLength % 8, 0);
      const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, "AES-KW", name, true, key.usages));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), await f.settle(f.subtle.exportKey(format, key)));
    });
  }

  test(`AES-KW rejects ${name} SPKI's incompatible octet length`, async () => {
    const f = fixture();
    const key = await f.key(name, "public");
    const wrapping = await f.wrapping("AES-KW");
    await assert.rejects(f.settle(f.subtle.wrapKey("spki", key, wrapping, "AES-KW")), dom("OperationError"));
  });

  test(`${name} unwrap preserves opaque all-zero public encodings`, async () => {
    const f = fixture();
    const usages = name === "Ed25519" ? ["verify"] : [];
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(32), name, true, usages));
    const wrapping = await f.wrapping("AES-GCM");
    const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
    const wrapped = await f.settle(f.subtle.wrapKey("jwk", key, wrapping, algorithm));
    const restored = await f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm, name, true, usages));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", restored)), new ArrayBuffer(32));
  });
}

test("25519 unwrap snapshots cipher parameters before target normalization", async () => {
  const f = fixture();
  const wrapping = await f.wrapping("AES-GCM");
  const key = await f.key("Ed25519", "private");
  const iv = new Uint8Array(12).fill(0x49);
  const algorithm = { name: "AES-GCM", iv };
  const wrapped = await f.settle(f.subtle.wrapKey("pkcs8", key, wrapping, algorithm));
  const restored = await f.settle(f.subtle.unwrapKey("pkcs8", wrapped, wrapping, algorithm, {
    get name() { iv.fill(0); return "Ed25519"; },
    get hash() { throw new Error("Ed25519 has no hash parameter"); },
    get namedCurve() { throw new Error("Ed25519 has no namedCurve parameter"); },
  }, true, ["sign"]));
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign("Ed25519", restored, ed25519Message()))), ed25519Signature());
});

test("25519 unwrap authenticates before rejecting a mismatched key algorithm", async () => {
  const f = fixture();
  const wrapping = await f.wrapping("AES-GCM");
  const key = await f.key("Ed25519", "private");
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
  const wrapped = new Uint8Array(await f.settle(f.subtle.wrapKey("pkcs8", key, wrapping, algorithm)));
  await assert.rejects(f.settle(f.subtle.unwrapKey("pkcs8", wrapped, wrapping, algorithm, "X25519", true, ["deriveBits"])), dom("DataError"));
  wrapped[0]! ^= 1;
  await assert.rejects(f.settle(f.subtle.unwrapKey("pkcs8", wrapped, wrapping, algorithm, "X25519", true, ["deriveBits"])), dom("OperationError"));
});
