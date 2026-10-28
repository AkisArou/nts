// Specification controls: Web Cryptography §§14.3.7–8, 24.4.2 and §§27–31
// get-key-length operations. https://w3c.github.io/webcrypto/
// RFC 5903 known answers come from ec-fixtures.ts; no Node WebCrypto is used.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoDerivationParameters, CryptoFailure, CryptoKeyHandle, CryptoKeyImport,
  CryptoKeyRecord, CryptoNamedCurve,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { ecdhPrivateJwk, ecdhPublicJwk, ecdhSecret } from "./ec-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  imports = 0;
  deriveFailure: CryptoFailure | undefined;
  importFailure: CryptoFailure | undefined;
  lastImport: CryptoKeyImport | undefined;
  lastSecret: Uint8Array | undefined;

  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    const result = this.deriveFailure ?? super.derive(parameters, key);
    if (!("failure" in result)) this.lastSecret = result;
    return result;
  }

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    this.lastImport = input;
    return this.importFailure ?? super.importKey(input);
  }
}

class CountingScheduler extends VirtualScheduler {
  enqueues = 0;
  override enqueue(task: () => void): void {
    this.enqueues++;
    super.enqueue(task);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new CountingScheduler();
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { bytes.fill(7); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function keys(curve: CryptoNamedCurve = "P-256", usages: readonly KeyUsage[] = ["deriveBits", "deriveKey"]) {
    const privateKey = await settle(subtle.importKey("jwk", ecdhPrivateJwk(curve, "initiator"),
      { name: "ECDH", namedCurve: curve }, false, usages));
    const publicKey = await settle(subtle.importKey("jwk", ecdhPublicJwk(curve, "responder"),
      { name: "ECDH", namedCurve: curve }, false, []));
    provider.imports = 0;
    scheduler.enqueues = 0;
    return { privateKey, publicKey };
  }
  return { provider, scheduler, subtle, settle, keys };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function leadingBits(bytes: Uint8Array, bits: number): Uint8Array {
  const result = bytes.slice(0, Math.ceil(bits / 8));
  if (bits % 8 !== 0) result[result.length - 1]! &= 0xff << (8 - bits % 8);
  return result;
}

for (const curve of ["P-256", "P-384", "P-521"] as const) {
  for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
    test(`${curve} deriveKey imports all AES lengths for ${name} from the RFC 5903 secret`, async () => {
      const f = fixture();
      const keys = await f.keys(curve);
      const usages = name === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
      for (const length of [128, 192, 256]) {
        const beforeDerive = f.provider.derives;
        const beforeImport = f.provider.imports;
        const beforeQueue = f.scheduler.enqueues;
        const pending = f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
          { name, length }, true, usages);
        assert.equal(f.provider.derives, beforeDerive + 1, "derive executes synchronously once");
        assert.equal(f.provider.imports, beforeImport + 1, "derived key imports synchronously once");
        assert.equal(f.scheduler.enqueues, beforeQueue + 1, "deriveKey settles from one task");
        const key = await f.settle(pending);
        assert.equal(key.type, "secret");
        assert.equal(key.extractable, true);
        assert.deepEqual(key.algorithm, { name, length });
        assert.deepEqual(key.usages, usages);
        const output = await f.settle(f.subtle.exportKey("raw", key));
        assert.deepEqual(output, ecdhSecret(curve).slice(0, length / 8).buffer);
      }
    });
  }
}

for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
  test(`deriveKey HMAC ${hash} preserves logical lengths and signs with the derived bytes`, async () => {
    const f = fixture();
    const keys = await f.keys("P-521");
    for (const length of [1, 13, 256, 521, 528]) {
      const key = await f.settle(f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
        { name: "HMAC", hash, length }, true, ["verify", "sign", "sign"]));
      assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length });
      assert.deepEqual(key.usages, ["sign", "verify"]);
      const expected = leadingBits(ecdhSecret("P-521"), length);
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), expected.buffer);
      const data = new Uint8Array([3, 1, 4, 1, 5]);
      const signature = await f.settle(f.subtle.sign("HMAC", key, data));
      const native = createHmac(hash.replace("-", "").toLowerCase(), expected).update(data).digest();
      assert.deepEqual(new Uint8Array(signature), new Uint8Array(native));
    }
  });

  test(`deriveKey HMAC ${hash} defaults to the hash block size`, async () => {
    const f = fixture();
    const keys = await f.keys("P-521");
    const pending = f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
      { name: "HMAC", hash }, true, ["sign"]);
    if (hash === "SHA-384" || hash === "SHA-512") {
      await assert.rejects(f.settle(pending), dom("OperationError"));
      assert.equal(f.provider.derives, 0, "1024 bits exceeds the 528-bit ECDH output");
      assert.equal(f.provider.imports, 0);
    } else {
      const key = await f.settle(pending);
      assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length: 512 });
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), ecdhSecret("P-521").slice(0, 64).buffer);
    }
  });
}

test("deriveKey permissions are independent of deriveBits and enforce private slots", async () => {
  const f = fixture();
  const bitsOnly = await f.keys("P-256", ["deriveBits"]);
  bitsOnly.privateKey.usages.push("deriveKey");
  bitsOnly.privateKey.algorithm.name = "ECDSA";
  await assert.rejects(f.settle(f.subtle.deriveKey({ name: "ECDH", public: bitsOnly.publicKey }, bitsOnly.privateKey,
    { name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom("InvalidAccessError"));
  assert.equal(f.provider.derives, 0);
  assert.deepEqual(await f.settle(f.subtle.deriveBits({ name: "ECDH", public: bitsOnly.publicKey }, bitsOnly.privateKey)), ecdhSecret("P-256").buffer);
  const keyOnly = await f.keys("P-256", ["deriveKey"]);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: keyOnly.publicKey }, keyOnly.privateKey)), dom("InvalidAccessError"));
  const key = await f.settle(f.subtle.deriveKey({ name: "ECDH", public: keyOnly.publicKey }, keyOnly.privateKey,
    { name: "AES-GCM", length: 128 }, false, ["encrypt"]));
  assert.equal(key.extractable, false);
  await assert.rejects(f.settle(f.subtle.exportKey("raw", key)), dom("InvalidAccessError"));
});

test("deriveKey validates target key length after base permission and before deriving", async () => {
  const f = fixture();
  const keys = await f.keys();
  for (const [algorithm, error] of [
    [{ name: "AES-GCM", length: 0 }, "OperationError"],
    [{ name: "AES-GCM", length: 129 }, "OperationError"],
    [{ name: "HMAC", hash: "SHA-256", length: 0 }, "TypeError"],
    [{ name: "HMAC", hash: "SHA-256", length: 257 }, "OperationError"],
  ] as const) {
    const pending = f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey, algorithm, true, ["sign"]);
    assert.equal(f.scheduler.hasPending, true);
    await assert.rejects(f.settle(pending), error === "TypeError" ? TypeError : dom(error));
  }
  assert.equal(f.provider.derives, 0);
  assert.equal(f.provider.imports, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.publicKey,
    { name: "HMAC", hash: "SHA-256", length: 0 }, true, ["sign"])), dom("InvalidAccessError"));
});

test("deriveKey applies target usage policy after derivation, and empty usages after import", async () => {
  const f = fixture();
  const keys = await f.keys();
  await assert.rejects(f.settle(f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
    { name: "AES-CBC", length: 128 }, true, ["sign"])), dom("SyntaxError"));
  assert.equal(f.provider.derives, 1);
  assert.equal(f.provider.imports, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
    { name: "AES-CBC", length: 128 }, true, [])), dom("SyntaxError"));
  assert.equal(f.provider.derives, 2);
  assert.equal(f.provider.imports, 1);
});

test("deriveKey converts all IDL arguments before its three ordered normalizations", async () => {
  const f = fixture();
  const keys = await f.keys();
  const reads: string[] = [];
  let lengthReads = 0;
  const baseAlgorithm = {
    get name() { reads.push("base.name"); return "ECDH"; },
    get public() { reads.push("base.public"); return keys.publicKey; },
  };
  const targetAlgorithm = {
    get name() { reads.push("target.name"); return "HMAC"; },
    get hash() { reads.push("target.hash"); return { get name() { reads.push("hash.name"); return "SHA-256"; } }; },
    get length() { reads.push("target.length"); return ++lengthReads === 1 ? 13 : 16; },
  };
  const usages = {
    *[Symbol.iterator]() { reads.push("usages"); yield "sign"; },
  };
  const key = await f.settle(f.subtle.deriveKey(baseAlgorithm, keys.privateKey, targetAlgorithm, true, usages));
  assert.deepEqual(reads, [
    "usages", "base.name", "base.name", "base.public",
    "target.name", "target.name", "target.hash", "target.length", "hash.name", "hash.name",
    "target.name", "target.name", "target.hash", "target.length", "hash.name", "hash.name",
  ]);
  assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: "SHA-256" }, length: 13 });
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), leadingBits(ecdhSecret("P-256"), 13).buffer);
});

test("deriveKey preserves distinct target import and length algorithms", async () => {
  const f = fixture();
  const keys = await f.keys();
  let names = 0;
  const target = {
    get name() { return ++names <= 2 ? "AES-GCM" : "AES-CTR"; },
    length: 128,
  };
  const key = await f.settle(f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
    target, true, ["encrypt"]));
  assert.equal(names, 4);
  assert.deepEqual(key.algorithm, { name: "AES-GCM", length: 128 });
});

test("deriveKey rejects algorithms without get-key-length support during normalization", async () => {
  const f = fixture();
  const keys = await f.keys();
  for (const target of [{ name: "ECDSA", namedCurve: "P-256" }, { name: "RSA-PSS", hash: "SHA-256" }, "SHA-256"]) {
    const pending = f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey, target, true, ["sign"]);
    assert.equal(f.scheduler.hasPending, false);
    await assert.rejects(pending, dom("NotSupportedError"));
  }
  assert.equal(f.provider.derives, 0);
  assert.equal(f.provider.imports, 0);
});

test("deriveKey normalization errors remain immediate and preserve thrown values", async () => {
  const f = fixture();
  const keys = await f.keys();
  const marker = { normalization: "failed" };
  const pending = f.subtle.deriveKey({ name: "ECDH", public: keys.publicKey }, keys.privateKey,
    { get name() { throw marker; } }, true, ["encrypt"]);
  assert.equal(f.scheduler.hasPending, false);
  await assert.rejects(pending, error => error === marker);
  assert.equal(f.provider.derives, 0);
});

for (const failure of ["invalid-key", "operation"] as const) {
  test(`deriveKey maps native ${failure} derivation and import failures at their respective boundaries`, async () => {
    const f = fixture();
    const keys = await f.keys();
    const algorithm = { name: "ECDH", public: keys.publicKey };
    const target = { name: "AES-GCM", length: 128 };
    f.provider.deriveFailure = { failure };
    const pending = f.subtle.deriveKey(algorithm, keys.privateKey, target, true, ["encrypt"]);
    assert.equal(f.scheduler.enqueues, 1);
    await assert.rejects(f.settle(pending), dom("OperationError"));
    assert.equal(f.provider.imports, 0);
    f.provider.deriveFailure = undefined;
    f.provider.importFailure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, keys.privateKey, target, true, ["encrypt"])),
      dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    assert.equal(f.provider.derives, 2);
    assert.equal(f.provider.imports, 1);
  });
}

test("deriveBits missing, undefined and null lengths all request the full P-521 encoding", async () => {
  const f = fixture();
  const keys = await f.keys("P-521");
  const algorithm = { name: "ECDH", public: keys.publicKey };
  for (const pending of [f.subtle.deriveBits(algorithm, keys.privateKey),
    f.subtle.deriveBits(algorithm, keys.privateKey, undefined), f.subtle.deriveBits(algorithm, keys.privateKey, null)]) {
    const bits = await f.settle(pending);
    assert.equal(bits.byteLength, 66);
    assert.deepEqual(bits, ecdhSecret("P-521").buffer);
  }
  assert.equal(f.provider.derives, 3);
});

test("deriveBits length uses nullable EnforceRange conversion before algorithm normalization", async () => {
  const f = fixture();
  const keys = await f.keys();
  let reads = 0;
  const algorithm = { get name() { reads++; return "ECDH"; }, public: keys.publicKey };
  for (const length of [-1, 2 ** 32, NaN, Infinity, -Infinity, Symbol("bits"), 1n]) {
    const pending = f.subtle.deriveBits(algorithm, keys.privateKey, length);
    assert.equal(f.scheduler.hasPending, false);
    await assert.rejects(pending, TypeError);
  }
  assert.equal(reads, 0);
  assert.equal(f.provider.derives, 0);
  for (const [length, expected] of [[-0.9, 0], [7.9, 7], ["13", 13], [false, 0], [true, 1]] as const) {
    const output = await f.settle(f.subtle.deriveBits(algorithm, keys.privateKey, length));
    assert.deepEqual(output, leadingBits(ecdhSecret("P-256"), expected).buffer);
  }
  await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, keys.privateKey, 0xffffffff)), dom("OperationError"));
});

test("deriveBits converts length after base branding and before reading the algorithm dictionary", async () => {
  const f = fixture();
  const keys = await f.keys();
  const reads: string[] = [];
  const length = { valueOf() { reads.push("length"); return 8; } };
  const algorithm = {
    get name() { reads.push("name"); return "ECDH"; },
    get public() { reads.push("public"); return keys.publicKey; },
  };
  await assert.rejects(f.subtle.deriveBits(algorithm, {}, length), TypeError);
  assert.deepEqual(reads, []);
  await f.settle(f.subtle.deriveBits(algorithm, keys.privateKey, length));
  assert.deepEqual(reads, ["length", "name", "name", "public"]);
});

test("derivation methods reject missing required arguments without scheduling work", async () => {
  const f = fixture();
  const deriveBits = f.subtle.deriveBits.bind(f.subtle) as (...args: unknown[]) => Promise<ArrayBuffer>;
  const deriveKey = f.subtle.deriveKey.bind(f.subtle) as (...args: unknown[]) => Promise<unknown>;
  await assert.rejects(deriveBits("ECDH"), TypeError);
  await assert.rejects(deriveKey("ECDH"), TypeError);
  assert.equal(f.scheduler.hasPending, false);
  assert.equal(f.provider.derives, 0);
});
