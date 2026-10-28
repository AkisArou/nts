// Web Cryptography §§14.3.7, 14.3.12, 33–34. Agreement-to-KDF expectations
// begin with the independent RFC 5903 / RFC 7748 secrets, not a peer round trip.
import assert from "node:assert/strict";
import { createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoDerivationParameters, CryptoDigestName, CryptoFailure, CryptoKeyHandle,
  CryptoKeyImport, CryptoKeyRecord } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { ecdhPrivateJwk, ecdhPublicJwk, ecdhSecret } from "./ec-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { x25519PrivateJwk, x25519PublicJwk, x25519Secret } from "./okp-fixtures.ts";

type KdfName = "HKDF" | "PBKDF2";
const password = new Uint8Array([0, 0x80, 0xff, 1, 2, 3]);
const salt = new Uint8Array([13, 21, 34]);
const info = new Uint8Array([55, 89]);

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  imports = 0;
  imported: CryptoKeyImport | undefined;
  derivedFailure: CryptoFailure | undefined;
  importFailure: CryptoFailure | undefined;
  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    return this.derivedFailure ?? super.derive(parameters, key);
  }
  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    this.imported = input;
    return this.importFailure ?? super.importKey(input);
  }
}

class CountingScheduler extends VirtualScheduler {
  enqueues = 0;
  override enqueue(task: () => void): void { this.enqueues++; super.enqueue(task); }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new CountingScheduler();
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { bytes.fill(7); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: KdfName, usages: readonly KeyUsage[] = ["deriveKey", "deriveBits"]) {
    const result = await settle(subtle.importKey("raw", password, name, false, usages));
    provider.derives = 0;
    provider.imports = 0;
    scheduler.enqueues = 0;
    return result;
  }
  return { provider, scheduler, subtle, settle, key };
}

function parameters(name: KdfName, hash: CryptoDigestName = "SHA-256") {
  return { name, hash, salt, info, iterations: 2 };
}

function expected(name: KdfName, hash: CryptoDigestName, key: Uint8Array, length: number): Uint8Array {
  const nativeHash = hash.replace("-", "").toLowerCase();
  return name === "HKDF" ? new Uint8Array(hkdfSync(nativeHash, key, salt, info, length))
    : new Uint8Array(pbkdf2Sync(key, salt, 2, length, nativeHash));
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

for (const name of ["HKDF", "PBKDF2"] as const) {
  for (const target of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
    test(`${name} derives ${target} at every AES key length`, async () => {
      const f = fixture();
      const base = await f.key(name, ["deriveKey"]);
      for (const length of [128, 192, 256]) {
        const usages = target === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
        const derives = f.provider.derives;
        const imports = f.provider.imports;
        const enqueues = f.scheduler.enqueues;
        const pending = f.subtle.deriveKey(parameters(name), base, { name: target, length }, true, usages);
        assert.equal(f.provider.derives, derives + 1);
        assert.equal(f.provider.imports, imports + 1);
        assert.equal(f.scheduler.enqueues, enqueues + 1);
        const key = await f.settle(pending);
        assert.deepEqual(key.algorithm, { name: target, length });
        assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), expected(name, "SHA-256", password, length / 8).buffer);
      }
    });
  }

  for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
    test(`${name} derives usable HMAC ${hash} keys with explicit and default lengths`, async () => {
      const f = fixture();
      const base = await f.key(name);
      for (const length of [128, undefined]) {
        const bits = length ?? (hash === "SHA-384" || hash === "SHA-512" ? 1024 : 512);
        const key = await f.settle(f.subtle.deriveKey(parameters(name, hash), base,
          { name: "HMAC", hash, length }, true, ["verify", "sign", "sign"]));
        const bytes = expected(name, hash, password, bits / 8);
        assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length: bits });
        assert.deepEqual(key.usages, ["sign", "verify"]);
        assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), bytes.buffer);
        assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign("HMAC", key, info))),
          new Uint8Array(createHmac(hash.replace("-", "").toLowerCase(), bytes).update(info).digest()));
      }
    });
  }

  test(`${name} deriveKey preserves target length, permission and import error order`, async () => {
    const f = fixture();
    const base = await f.key(name, ["deriveKey"]);
    const algorithm = parameters(name);
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, base, 128)), dom("InvalidAccessError"));
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "HMAC", hash: "SHA-256", length: 0 }, true, ["sign"])), TypeError);
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "AES-GCM", length: 129 }, true, ["encrypt"])), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "HMAC", hash: "SHA-256", length: 9 }, true, ["sign"])), dom("OperationError"));
    assert.equal(f.provider.derives, 0);
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "AES-GCM", length: 128 }, true, ["sign"])), dom("SyntaxError"));
    assert.equal(f.provider.derives, 1);
    assert.equal(f.provider.imports, 0);
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "AES-GCM", length: 128 }, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.derives, 2);
    assert.equal(f.provider.imports, 1);
    const key = await f.settle(f.subtle.deriveKey(algorithm, base,
      { name: "AES-GCM", length: 128 }, false, ["encrypt"]));
    assert.equal(key.extractable, false);
    await assert.rejects(f.settle(f.subtle.exportKey("raw", key)), dom("InvalidAccessError"));
  });

  test(`${name} cannot derive a KDF target whose requested length is null`, async () => {
    const f = fixture();
    const base = await f.key(name);
    for (const target of ["HKDF", "PBKDF2"]) {
      await assert.rejects(f.settle(f.subtle.deriveKey(parameters(name), base, target, false, ["deriveBits"])), dom("OperationError"));
    }
    assert.equal(f.provider.derives, 0);
    assert.equal(f.provider.imports, 0);
  });

  test(`${name} deriveKey snapshots parameters before normalizing its target twice`, async () => {
    const f = fixture();
    const base = await f.key(name);
    const mutableSalt = salt.slice();
    const mutableInfo = info.slice();
    const reads: string[] = [];
    const target = {
      get name() { reads.push("name"); mutableSalt.fill(0); mutableInfo.fill(0); return "HMAC"; },
      get hash() { reads.push("hash"); return "SHA-256"; },
      get length() { reads.push("length"); return 128; },
    };
    const key = await f.settle(f.subtle.deriveKey({ ...parameters(name), salt: mutableSalt, info: mutableInfo },
      base, target, true, ["sign"]));
    assert.deepEqual(reads, ["name", "name", "hash", "length", "name", "name", "hash", "length"]);
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), expected(name, "SHA-256", password, 16).buffer);
  });

  test(`${name} uses the target length normalization independently of import length`, async () => {
    const f = fixture();
    const base = await f.key(name);
    let reads = 0;
    const target = { name: "HMAC", hash: "SHA-256", get length() { return ++reads === 1 ? 9 : 16; } };
    const key = await f.settle(f.subtle.deriveKey(parameters(name), base, target, true, ["sign"]));
    assert.equal(reads, 2);
    assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: "SHA-256" }, length: 9 });
    const bytes = expected(name, "SHA-256", password, 2);
    bytes[1]! &= 0x80;
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), bytes.buffer);
  });

  for (const failure of ["invalid-key", "operation"] as const) {
    test(`${name} deriveKey maps ${failure} failures at the correct stage`, async () => {
      const f = fixture();
      const base = await f.key(name);
      f.provider.derivedFailure = { failure };
      await assert.rejects(f.settle(f.subtle.deriveKey(parameters(name), base,
        { name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom("OperationError"));
      assert.equal(f.provider.imports, 0);
      assert.equal(f.scheduler.enqueues, 1);
      f.provider.derivedFailure = undefined;
      f.provider.importFailure = { failure };
      await assert.rejects(f.settle(f.subtle.deriveKey(parameters(name), base,
        { name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
      assert.equal(f.provider.imports, 1);
      assert.equal(f.scheduler.enqueues, 2);
    });
  }

  for (const curve of ["X25519", "P-256", "P-384", "P-521"] as const) {
    test(`${curve} derives a usable ${name} key from the complete published agreement secret`, async () => {
      const f = fixture();
      const x = curve === "X25519";
      const algorithm = x ? { name: "X25519" } : { name: "ECDH", namedCurve: curve };
      const privateKey = await f.settle(f.subtle.importKey("jwk", x ? x25519PrivateJwk("alice") : ecdhPrivateJwk(curve, "initiator"),
        algorithm, false, ["deriveKey"]));
      const publicKey = await f.settle(f.subtle.importKey("jwk", x ? x25519PublicJwk("bob") : ecdhPublicJwk(curve, "responder"),
        algorithm, false, []));
      const secret = x ? x25519Secret() : ecdhSecret(curve);
      const key = await f.settle(f.subtle.deriveKey({ name: algorithm.name, public: publicKey }, privateKey, name, false, ["deriveBits"]));
      assert.deepEqual(key.algorithm, { name });
      assert.equal(key.extractable, false);
      const imported = f.provider.imported;
      assert.ok(imported?.format === "raw" && imported.family === "secret");
      assert.deepEqual(imported.bytes, secret);
      assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits(parameters(name), key, 256))),
        expected(name, "SHA-256", secret, 32));
      await assert.rejects(f.settle(f.subtle.deriveKey({ name: algorithm.name, public: publicKey }, privateKey,
        name, true, ["deriveBits"])), dom("SyntaxError"));
    });
  }

  test(`AES-GCM unwraps ${name} raw bytes and applies import policy after authentication`, async () => {
    const f = fixture();
    const aes = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ["encrypt", "unwrapKey"]));
    const cipher = { name: "AES-GCM", iv: new Uint8Array(12) };
    const wrapped = await f.settle(f.subtle.encrypt(cipher, aes, password));
    const key = await f.settle(f.subtle.unwrapKey("raw", wrapped, aes, cipher, name, false, ["deriveBits"]));
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits(parameters(name), key, 128))),
      expected(name, "SHA-256", password, 16));
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw", wrapped, aes, cipher, name, true, ["deriveBits"])), dom("SyntaxError"));
    await assert.rejects(f.settle(f.subtle.unwrapKey("spki", wrapped, aes, cipher, name, false, ["deriveBits"])), dom("NotSupportedError"));
    const corrupted = new Uint8Array(wrapped.slice(0));
    corrupted[0]! ^= 1;
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw", corrupted, aes, cipher, name, true, ["deriveBits"])), dom("OperationError"));
  });
}
