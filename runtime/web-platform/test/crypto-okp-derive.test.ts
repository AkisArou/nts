// Web Cryptography §§14.3.7–8 and 26.3.1, plus AES/HMAC get-key-length
// operations. Expected bytes are the independent RFC 7748 §6.1 shared secret.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoDerivationParameters, CryptoFailure, CryptoKeyHandle, CryptoKeyImport, CryptoKeyRecord,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { x25519PrivateJwk, x25519PublicJwk, x25519Secret } from "./okp-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  imports = 0;
  derived: Uint8Array | CryptoFailure | undefined;
  imported: CryptoKeyImport | undefined;
  importFailure: CryptoFailure | undefined;

  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    return this.derived ?? super.derive(parameters, key);
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
  async function keys(usages: readonly KeyUsage[] = ["deriveKey", "deriveBits"]) {
    const privateKey = await settle(subtle.importKey("jwk", x25519PrivateJwk("alice"), "X25519", false, usages));
    const publicKey = await settle(subtle.importKey("jwk", x25519PublicJwk("bob"), "X25519", false, []));
    provider.imports = 0;
    scheduler.enqueues = 0;
    return { privateKey, publicKey };
  }
  return { provider, scheduler, subtle, settle, keys };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function leadingBits(length: number): Uint8Array {
  const expected = x25519Secret().slice(0, Math.ceil(length / 8));
  if (length % 8 !== 0) expected[expected.length - 1]! &= 0xff << (8 - length % 8);
  return expected;
}

for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
  test(`X25519 derives ${name} keys of every AES length from the RFC 7748 secret`, async () => {
    const f = fixture();
    const keys = await f.keys();
    const usages = name === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
    for (const length of [128, 192, 256]) {
      const derives = f.provider.derives;
      const imports = f.provider.imports;
      const enqueues = f.scheduler.enqueues;
      const pending = f.subtle.deriveKey({ name: "x25519", public: keys.publicKey }, keys.privateKey,
        { name, length }, true, usages);
      assert.equal(f.provider.derives, derives + 1);
      assert.equal(f.provider.imports, imports + 1);
      assert.equal(f.scheduler.enqueues, enqueues + 1);
      const key = await f.settle(pending);
      assert.equal(key.type, "secret");
      assert.equal(key.extractable, true);
      assert.deepEqual(key.algorithm, { name, length });
      assert.deepEqual(key.usages, usages);
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), leadingBits(length).buffer);
    }
  });
}

for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
  test(`X25519 derives logical-bit HMAC ${hash} keys and uses the requested hash`, async () => {
    const f = fixture();
    const keys = await f.keys();
    const data = new Uint8Array([5, 8, 13]);
    for (const length of [1, 9, 128, 255, 256]) {
      const key = await f.settle(f.subtle.deriveKey({ name: "X25519", public: keys.publicKey }, keys.privateKey,
        { name: "HMAC", hash, length }, true, ["verify", "sign", "sign"]));
      assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length });
      assert.deepEqual(key.usages, ["sign", "verify"]);
      const expected = leadingBits(length);
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), expected.buffer);
      const signature = await f.settle(f.subtle.sign("HMAC", key, data));
      assert.deepEqual(new Uint8Array(signature), new Uint8Array(createHmac(hash.replace("-", "").toLowerCase(), expected).update(data).digest()));
    }
  });

  test(`X25519 rejects the default HMAC ${hash} block length before agreement`, async () => {
    const f = fixture();
    const keys = await f.keys();
    const pending = f.subtle.deriveKey({ name: "X25519", public: keys.publicKey }, keys.privateKey,
      { name: "HMAC", hash }, true, ["sign"]);
    assert.equal(f.scheduler.enqueues, 1);
    await assert.rejects(f.settle(pending), dom("OperationError"));
    assert.equal(f.provider.derives, 0);
    assert.equal(f.provider.imports, 0);
  });
}

test("X25519 deriveKey rejects a full all-zero secret before importing a target key", async () => {
  const f = fixture();
  const keys = await f.keys();
  for (const target of [{ name: "AES-GCM", length: 128 }, { name: "HMAC", hash: "SHA-256", length: 1 }]) {
    f.provider.derived = new Uint8Array(32);
    const pending = f.subtle.deriveKey({ name: "X25519", public: keys.publicKey }, keys.privateKey, target, true,
      target.name === "HMAC" ? ["sign"] : ["encrypt"]);
    await assert.rejects(f.settle(pending), dom("OperationError"));
    assert.equal(f.provider.imports, 0);
  }
  assert.equal(f.provider.derives, 2);
});

test("X25519 tests all 32 secret octets before allowing an all-zero truncated AES key", async () => {
  const f = fixture();
  const keys = await f.keys();
  const secret = new Uint8Array(32);
  secret[31] = 1;
  f.provider.derived = secret;
  const key = await f.settle(f.subtle.deriveKey({ name: "X25519", public: keys.publicKey }, keys.privateKey,
    { name: "AES-GCM", length: 128 }, true, ["encrypt"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), new ArrayBuffer(16));
  assert.equal(secret[31], 1, "truncation does not mutate the full native output");
  assert.equal(f.provider.imports, 1);
  assert.equal(f.provider.derives, 1);
});

test("X25519 deriveKey uses private permissions independently of deriveBits", async () => {
  const f = fixture();
  const bitsOnly = await f.keys(["deriveBits"]);
  bitsOnly.privateKey.usages.push("deriveKey");
  await assert.rejects(f.settle(f.subtle.deriveKey({ name: "X25519", public: bitsOnly.publicKey }, bitsOnly.privateKey,
    { name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom("InvalidAccessError"));
  assert.equal(f.provider.derives, 0);
  const keyOnly = await f.keys(["deriveKey"]);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: keyOnly.publicKey }, keyOnly.privateKey)), dom("InvalidAccessError"));
  const derived = await f.settle(f.subtle.deriveKey({ name: "X25519", public: keyOnly.publicKey }, keyOnly.privateKey,
    { name: "AES-GCM", length: 128 }, false, ["encrypt"]));
  assert.equal(derived.extractable, false);
  await assert.rejects(f.settle(f.subtle.exportKey("raw", derived)), dom("InvalidAccessError"));
});

test("X25519 target key-length and usage errors happen at the specified boundaries", async () => {
  const f = fixture();
  const keys = await f.keys();
  const algorithm = { name: "X25519", public: keys.publicKey };
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey,
    { name: "HMAC", hash: "SHA-256", length: 0 }, true, ["sign"])), TypeError);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey,
    { name: "HMAC", hash: "SHA-256", length: 257 }, true, ["sign"])), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey,
    { name: "AES-GCM", length: 129 }, true, ["encrypt"])), dom("OperationError"));
  assert.equal(f.provider.derives, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey,
    { name: "AES-GCM", length: 128 }, true, ["verify"])), dom("SyntaxError"));
  assert.equal(f.provider.derives, 1);
  assert.equal(f.provider.imports, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey,
    { name: "AES-GCM", length: 128 }, true, [])), dom("SyntaxError"));
  assert.equal(f.provider.derives, 2);
  assert.equal(f.provider.imports, 1);
});

test("X25519 derivation normalizes target import and target length separately", async () => {
  const f = fixture();
  const keys = await f.keys();
  const reads: string[] = [];
  let lengths = 0;
  const algorithm = {
    get name() { reads.push("base.name"); return "X25519"; },
    get public() { reads.push("base.public"); return keys.publicKey; },
  };
  const target = {
    get name() { reads.push("target.name"); return "HMAC"; },
    get hash() { reads.push("target.hash"); return "SHA-256"; },
    get length() { reads.push("target.length"); return ++lengths === 1 ? 9 : 16; },
  };
  const key = await f.settle(f.subtle.deriveKey(algorithm, keys.privateKey, target, true, ["sign"]));
  assert.deepEqual(reads, ["base.name", "base.name", "base.public", "target.name", "target.name", "target.hash", "target.length",
    "target.name", "target.name", "target.hash", "target.length"]);
  assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: "SHA-256" }, length: 9 });
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), leadingBits(9).buffer);
});

test("25519 keys cannot be deriveKey targets without a get-key-length registration", async () => {
  const f = fixture();
  const keys = await f.keys();
  for (const target of ["Ed25519", "X25519"]) {
    const pending = f.subtle.deriveKey({ name: "X25519", public: keys.publicKey }, keys.privateKey, target, true, ["sign"]);
    assert.equal(f.scheduler.hasPending, false);
    await assert.rejects(pending, dom("NotSupportedError"));
  }
  assert.equal(f.provider.derives, 0);
});

for (const failure of ["invalid-key", "operation"] as const) {
  test(`X25519 deriveKey maps native ${failure} values and settles only once`, async () => {
    const f = fixture();
    const keys = await f.keys();
    const algorithm = { name: "X25519", public: keys.publicKey };
    const target = { name: "AES-GCM", length: 128 };
    f.provider.derived = { failure };
    const pending = f.subtle.deriveKey(algorithm, keys.privateKey, target, true, ["encrypt"]);
    assert.equal(f.scheduler.enqueues, 1);
    await assert.rejects(f.settle(pending), dom("OperationError"));
    assert.equal(f.provider.imports, 0);
    f.provider.derived = undefined;
    f.provider.importFailure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey, target, true, ["encrypt"])),
      dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    assert.equal(f.scheduler.enqueues, 2);
    assert.equal(f.provider.imports, 1);
  });
}
