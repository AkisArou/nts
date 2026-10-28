// Specification controls: Web Cryptography §§9, 14.3.11–12, 20–22, 27–30.
// https://w3c.github.io/webcrypto/#SubtleCrypto-method-wrapKey
// These exercise this package with Node's native primitives, never Node WebCrypto.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoCipherParameters, CryptoCiphertext, CryptoFailure, CryptoKeyHandle,
  CryptoKeyImport, CryptoKeyRecord,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { rsaPkcs8, rsaSpki } from "./rsa-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  exports = 0;
  encrypts = 0;
  decrypts = 0;
  importFailure: CryptoFailure | undefined;
  cipherFailure: CryptoFailure | undefined;
  label: Uint8Array | undefined;
  encrypted: Uint8Array | undefined;
  decrypted: Uint8Array | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    return this.importFailure ?? super.importKey(input);
  }
  override exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    this.exports++;
    return super.exportKey(key, format);
  }
  override encrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoCiphertext | CryptoFailure {
    this.encrypts++;
    this.encrypted = data;
    if (parameters.name === "RSA-OAEP") this.label = parameters.label;
    return this.cipherFailure ?? super.encrypt(parameters, key, data);
  }
  override decrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: CryptoCiphertext): Uint8Array | CryptoFailure {
    this.decrypts++;
    this.decrypted = data.bytes;
    if (parameters.name === "RSA-OAEP") this.label = parameters.label;
    return this.cipherFailure ?? super.decrypt(parameters, key, data);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const subtle = new Crypto({ fill(bytes: Uint8Array): void { bytes.fill(0xa5); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function rsa(type: "public" | "private", name: string, usages: readonly KeyUsage[], extractable = true) {
    return settle(subtle.importKey(type === "public" ? "spki" : "pkcs8", type === "public" ? rsaSpki() : rsaPkcs8(),
      { name, hash: "SHA-256" }, extractable, usages));
  }
  async function aes(name = "AES-GCM", usages: readonly KeyUsage[] = ["wrapKey", "unwrapKey"]) {
    return settle(subtle.importKey("raw", new Uint8Array(16).fill(0x17), name, false, usages));
  }
  return { provider, scheduler, subtle, settle, rsa, aes };
}

function dom(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}

const wrappingAlgorithms = [
  { name: "AES-CTR", counter: new Uint8Array(16), length: 128 },
  { name: "AES-CBC", iv: new Uint8Array(16) },
  { name: "AES-GCM", iv: new Uint8Array(12), additionalData: new Uint8Array([1, 2, 3]) },
  { name: "AES-KW" },
] as const;

for (const algorithm of wrappingAlgorithms) {
  for (const [type, format] of [["public", "spki"], ["private", "pkcs8"], ["public", "jwk"], ["private", "jwk"]] as const) {
    // RFC3394 wraps multiples of eight octets. DER lengths are not adaptable;
    // its JWK path can add JSON whitespace as expressly allowed by §14.3.11.
    const incompatibleDer = algorithm.name === "AES-KW" && format !== "jwk";
    test(`${algorithm.name} wraps RSA ${type} ${format}${incompatibleDer ? " only at a valid octet boundary" : " and preserves key material"}`, async () => {
      const f = fixture();
      const usages: KeyUsage[] = type === "public" ? ["verify"] : ["sign"];
      const key = await f.rsa(type, "RSA-PSS", usages);
      const wrapping = await f.aes(algorithm.name);
      const original = await f.settle(f.subtle.exportKey(format, key));
      if (incompatibleDer) {
        assert.ok(original instanceof ArrayBuffer);
        assert.notEqual(original.byteLength % 8, 0);
        await assert.rejects(f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm)), dom("OperationError"));
        assert.equal(f.provider.encrypts, 0);
        return;
      }
      const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm));
      assert.ok(wrapped instanceof ArrayBuffer);
      if (format === "jwk") {
        assert.ok(f.provider.encrypted);
        const input = f.provider.encrypted;
        const padding = algorithm.name === "AES-CBC" ? input[input.byteLength - 1]! : 0;
        const unpadded = Buffer.from(input.subarray(0, input.byteLength - padding)).toString("utf8");
        assert.deepEqual(JSON.parse(unpadded), original);
        if (algorithm.name === "AES-KW") assert.equal(f.provider.encrypted.byteLength % 8, 0);
      }
      const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, algorithm,
        { name: "RSA-PSS", hash: "SHA-256" }, true, usages));
      assert.equal(restored.type, type);
      assert.deepEqual(restored.algorithm, key.algorithm);
      assert.deepEqual(restored.usages, usages);
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), original);
      assert.equal(f.provider.encrypts, 1);
      assert.equal(f.provider.decrypts, 1);
    });
  }
}

for (const format of ["raw", "jwk"] as const) {
  test(`RSA-OAEP ${format} wrapping needs only wrapKey and unwrapKey usages`, async () => {
    const f = fixture();
    const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"], false);
    const privateKey = await f.rsa("private", "RSA-OAEP", ["unwrapKey"], false);
    const data = new Uint8Array(16).fill(0x67);
    const key = await f.settle(f.subtle.importKey("raw", data, "AES-GCM", true, ["encrypt", "decrypt"]));
    const label = new Uint8Array([4, 5, 6]);
    const algorithm = { name: "RSA-OAEP", label };
    const wrapped = await f.settle(f.subtle.wrapKey(format, key, publicKey, algorithm));
    assert.equal(wrapped.byteLength, 256);
    assert.equal(f.provider.label, label, "one synchronous wrapping operation may borrow its label");
    const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, privateKey, algorithm, "AES-GCM", true, ["decrypt"]));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", restored)), data.buffer);
    assert.deepEqual(restored.usages, ["decrypt"]);
    await assert.rejects(f.settle(f.subtle.encrypt(algorithm, publicKey, data)), dom("InvalidAccessError"));
    await assert.rejects(f.settle(f.subtle.decrypt(algorithm, privateKey, wrapped)), dom("InvalidAccessError"));
    assert.equal(f.provider.encrypts, 1);
    assert.equal(f.provider.decrypts, 1);
  });
}

test("RSA-OAEP encryption-only and decryption-only keys cannot wrap or unwrap", async () => {
  const f = fixture();
  const publicKey = await f.rsa("public", "RSA-OAEP", ["encrypt"]);
  const privateKey = await f.rsa("private", "RSA-OAEP", ["decrypt"]);
  const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-CBC", true, ["encrypt"]));
  await assert.rejects(f.settle(f.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP")), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.unwrapKey("raw", new Uint8Array(256), privateKey, "RSA-OAEP", "AES-CBC", true, ["encrypt"])), dom("InvalidAccessError"));
  assert.equal(f.provider.exports, 0);
  assert.equal(f.provider.encrypts, 0);
  assert.equal(f.provider.decrypts, 0);
});

test("RSA wrapping applies key extractability before native export and encryption", async () => {
  const f = fixture();
  const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"]);
  const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ["encrypt"]));
  await assert.rejects(f.settle(f.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP")), dom("InvalidAccessError"));
  assert.equal(f.provider.exports, 0);
  assert.equal(f.provider.encrypts, 0);
});

test("RSA-OAEP label is copied before the unwrapped key's hash getter runs", async () => {
  const f = fixture();
  const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"]);
  const privateKey = await f.rsa("private", "RSA-OAEP", ["unwrapKey"]);
  const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16).fill(9), { name: "HMAC", hash: "SHA-256" }, true, ["sign"]));
  const label = new Uint8Array([7, 8, 9]);
  const wrapped = await f.settle(f.subtle.wrapKey("raw", key, publicKey, { name: "RSA-OAEP", label }));
  const unwrapped = await f.settle(f.subtle.unwrapKey("raw", wrapped, privateKey, { name: "RSA-OAEP", label }, {
    name: "HMAC",
    hash: { get name() { label.fill(0); return "SHA-256"; } },
  }, true, ["sign"]));
  assert.notEqual(f.provider.label, label);
  assert.deepEqual(f.provider.label, new Uint8Array([7, 8, 9]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", unwrapped)), new Uint8Array(16).fill(9).buffer);
});

test("RSA unwrap borrows wrapped bytes only after both normalizations", async () => {
  const f = fixture();
  const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"]);
  const privateKey = await f.rsa("private", "RSA-OAEP", ["unwrapKey"]);
  const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]));
  const wrapped = new Uint8Array(await f.settle(f.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP")));
  const pending = f.subtle.unwrapKey("raw", wrapped, privateKey, "RSA-OAEP", {
    get name() { wrapped.fill(0); return "AES-GCM"; },
  }, true, ["encrypt"]);
  assert.equal(f.provider.decrypted, wrapped);
  await assert.rejects(f.settle(pending), dom("OperationError"));
});

test("RSA wrap/unwrap fallback normalization observes the RSA dictionary once after lookup", async () => {
  const f = fixture();
  const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"]);
  const privateKey = await f.rsa("private", "RSA-OAEP", ["unwrapKey"]);
  const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-CBC", true, ["encrypt"]));
  const reads: string[] = [];
  const algorithm = {
    get name() { reads.push("name"); return "RSA-OAEP"; },
    get label() { reads.push("label"); return new Uint8Array(0); },
  };
  const wrapped = await f.settle(f.subtle.wrapKey("raw", key, publicKey, algorithm));
  assert.deepEqual(reads, ["name", "name", "name", "label"]);
  reads.length = 0;
  await f.settle(f.subtle.unwrapKey("raw", wrapped, privateKey, algorithm, "AES-CBC", true, ["encrypt"]));
  assert.deepEqual(reads, ["name", "name", "name", "label"]);
});

for (const failure of ["invalid-key", "operation"] as const) {
  test(`RSA wrapping maps native ${failure} cipher failures to queued OperationError`, async () => {
    const f = fixture();
    const publicKey = await f.rsa("public", "RSA-OAEP", ["wrapKey"]);
    const privateKey = await f.rsa("private", "RSA-OAEP", ["unwrapKey"]);
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-CBC", true, ["encrypt"]));
    f.provider.cipherFailure = { failure };
    const wrap = f.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP");
    let settled = false;
    void wrap.catch(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    await assert.rejects(f.settle(wrap), dom("OperationError"));
    const beforeImports = f.provider.imports;
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw", new Uint8Array(256), privateKey, "RSA-OAEP", "AES-CBC", true, ["encrypt"])), dom("OperationError"));
    assert.equal(f.provider.imports, beforeImports);
  });

  test(`RSA unwrapping maps native ${failure} import failure after decryption`, async () => {
    const f = fixture();
    const key = await f.rsa("private", "RSA-PSS", ["sign"]);
    const wrapping = await f.aes();
    const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
    const wrapped = await f.settle(f.subtle.wrapKey("pkcs8", key, wrapping, algorithm));
    f.provider.importFailure = { failure };
    await assert.rejects(f.settle(f.subtle.unwrapKey("pkcs8", wrapped, wrapping, algorithm,
      { name: "RSA-PSS", hash: "SHA-256" }, true, ["sign"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    assert.equal(f.provider.decrypts, 1);
  });
}

test("RSA JWK wrapping cannot be redirected through mutated public key snapshots", async () => {
  const f = fixture();
  const key = await f.rsa("private", "RSASSA-PKCS1-v1_5", ["sign"]);
  const wrapping = await f.aes();
  const expected = await f.settle(f.subtle.exportKey("jwk", key));
  key.algorithm.name = "RSA-OAEP";
  key.usages.splice(0, key.usages.length, "decrypt");
  const wrapped = await f.settle(f.subtle.wrapKey("jwk", key, wrapping, { name: "AES-GCM", iv: new Uint8Array(12) }));
  const restored = await f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, { name: "AES-GCM", iv: new Uint8Array(12) },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("jwk", restored)), expected);
});
