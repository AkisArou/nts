// Secure Curves §§4, 6 and Web Cryptography §§14.3.7, 14.3.11–12.
// Target-key expectations start with RFC 7748's independent X448 secret.
import assert from "node:assert/strict";
import { createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoDerivationParameters, CryptoFailure, CryptoKeyHandle, CryptoKeyImport, CryptoKeyRecord } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { curve448PrivateJwk, curve448PublicJwk, ed448Message, ed448Signature,
  x448PrivateJwk, x448PublicJwk, x448Secret } from "./curve448-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  imports = 0;
  derived: Uint8Array | CryptoFailure | undefined;
  importFailure: CryptoFailure | undefined;
  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    return this.derived ?? super.derive(parameters, key);
  }
  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
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
  const subtle = new Crypto({ fill(bytes: Uint8Array): void { bytes.fill(1); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function agreement(usages: readonly KeyUsage[] = ["deriveKey", "deriveBits"]) {
    const base = await settle(subtle.importKey("jwk", x448PrivateJwk("alice"), "X448", false, usages));
    const peer = await settle(subtle.importKey("jwk", x448PublicJwk("bob"), "X448", false, []));
    provider.derives = 0;
    provider.imports = 0;
    scheduler.enqueues = 0;
    return { base, algorithm: { name: "X448", public: peer } };
  }
  return { provider, scheduler, subtle, settle, agreement };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function prefix(bits: number): Uint8Array {
  const result = x448Secret().slice(0, Math.ceil(bits / 8));
  if (bits % 8 !== 0) result[result.length - 1]! &= 0xff << (8 - bits % 8);
  return result;
}

for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"] as const) {
  test(`X448 derives ${name} at all AES lengths with one primitive and one settlement`, async () => {
    const f = fixture();
    const { base, algorithm } = await f.agreement();
    for (const length of [128, 192, 256]) {
      const usages = name === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
      const derives = f.provider.derives;
      const imports = f.provider.imports;
      const enqueues = f.scheduler.enqueues;
      const pending = f.subtle.deriveKey(algorithm, base, { name, length }, true, usages);
      assert.equal(f.provider.derives, derives + 1);
      assert.equal(f.provider.imports, imports + 1);
      assert.equal(f.scheduler.enqueues, enqueues + 1);
      const key = await f.settle(pending);
      assert.deepEqual(key.algorithm, { name, length });
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), prefix(length).buffer);
    }
  });
}

for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
  test(`X448 derives ${hash} HMAC prefixes and rejects its oversized default after agreement`, async () => {
    const f = fixture();
    const { base, algorithm } = await f.agreement();
    const data = new Uint8Array([8, 9, 10]);
    for (const length of [1, 9, 256, 447, 448]) {
      const key = await f.settle(f.subtle.deriveKey(algorithm, base, { name: "HMAC", hash, length }, true, ["sign"]));
      const bytes = prefix(length);
      assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), bytes.buffer);
      assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign("HMAC", key, data))),
        new Uint8Array(createHmac(hash.replace("-", "").toLowerCase(), bytes).update(data).digest()));
    }
    const derives = f.provider.derives;
    const imports = f.provider.imports;
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base, { name: "HMAC", hash }, true, ["sign"])), dom("OperationError"));
    assert.equal(f.provider.derives, derives + 1, "Secure Curves checks requested length after X448 agreement");
    assert.equal(f.provider.imports, imports);
  });
}

for (const name of ["HKDF", "PBKDF2"] as const) {
  test(`X448 derives a nonextractable ${name} key from all 56 secret octets`, async () => {
    const f = fixture();
    const { base, algorithm } = await f.agreement();
    const key = await f.settle(f.subtle.deriveKey(algorithm, base, name, false, ["deriveBits"]));
    assert.deepEqual(key.algorithm, { name });
    assert.equal(key.extractable, false);
    const salt = new Uint8Array([1, 2]);
    const info = new Uint8Array([3, 4]);
    const output = await f.settle(f.subtle.deriveBits({ name, hash: "SHA-256", salt, info, iterations: 2 }, key, 256));
    const expected = name === "HKDF" ? new Uint8Array(hkdfSync("sha256", x448Secret(), salt, info, 32))
      : new Uint8Array(pbkdf2Sync(x448Secret(), salt, 2, 32, "sha256"));
    assert.deepEqual(new Uint8Array(output), expected);
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base, name, true, ["deriveBits"])), dom("SyntaxError"));
  });
}

test("X448 deriveKey permissions, length normalization and import errors remain distinct", async () => {
  const f = fixture();
  const { base, algorithm } = await f.agreement(["deriveKey"]);
  await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, base, 128)), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
    { name: "AES-GCM", length: 129 }, true, ["encrypt"])), dom("OperationError"));
  assert.equal(f.provider.derives, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
    { name: "AES-GCM", length: 128 }, true, ["sign"])), dom("SyntaxError"));
  assert.equal(f.provider.derives, 1);
  assert.equal(f.provider.imports, 0);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base,
    { name: "AES-GCM", length: 128 }, true, [])), dom("SyntaxError"));
  assert.equal(f.provider.imports, 1);
  const key = await f.settle(f.subtle.deriveKey(algorithm, base, { name: "AES-GCM", length: 128 }, false, ["encrypt"]));
  await assert.rejects(f.settle(f.subtle.exportKey("raw", key)), dom("InvalidAccessError"));
});

test("X448 tests all 56 secret octets before truncation and target import", async () => {
  const f = fixture();
  const { base, algorithm } = await f.agreement();
  f.provider.derived = new Uint8Array(56);
  await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base, { name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom("OperationError"));
  assert.equal(f.provider.imports, 0);
  f.provider.derived[55] = 1;
  const key = await f.settle(f.subtle.deriveKey(algorithm, base, { name: "AES-GCM", length: 128 }, true, ["encrypt"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), new ArrayBuffer(16));
  assert.equal(f.provider.derived[55], 1);
});

test("X448 normalizes import and get-key-length separately and rejects OKP targets", async () => {
  const f = fixture();
  const { base, algorithm } = await f.agreement();
  let reads = 0;
  const target = { name: "HMAC", hash: "SHA-256", get length() { return ++reads === 1 ? 9 : 16; } };
  const key = await f.settle(f.subtle.deriveKey(algorithm, base, target, true, ["sign"]));
  assert.equal(reads, 2);
  assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: "SHA-256" }, length: 9 });
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), prefix(9).buffer);
  for (const name of ["Ed25519", "X25519", "Ed448", "X448"]) {
    const pending = f.subtle.deriveKey(algorithm, base, name, true, ["sign"]);
    assert.equal(f.scheduler.hasPending, false);
    await assert.rejects(pending, dom("NotSupportedError"));
  }
});

for (const failure of ["invalid-key", "operation"] as const) {
  test(`X448 deriveKey maps ${failure} values and settles each result once`, async () => {
    const f = fixture();
    const { base, algorithm } = await f.agreement();
    const target = { name: "AES-GCM", length: 128 };
    f.provider.derived = { failure };
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base, target, true, ["encrypt"])), dom("OperationError"));
    assert.equal(f.provider.imports, 0);
    assert.equal(f.scheduler.enqueues, 1);
    f.provider.derived = undefined;
    f.provider.importFailure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveKey(algorithm, base, target, true, ["encrypt"])),
      dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    assert.equal(f.scheduler.enqueues, 2);
  });
}

for (const name of ["Ed448", "X448"] as const) {
  for (const [type, format] of [["public", "raw"], ["public", "spki"], ["private", "pkcs8"], ["public", "jwk"], ["private", "jwk"]] as const) {
    test(`AES-GCM wraps ${name} ${type} ${format} and restores usable material`, async () => {
      const f = fixture();
      const usages = name === "Ed448" ? [type === "private" ? "sign" : "verify"] : type === "private" ? ["deriveBits"] : [];
      const key = await f.settle(f.subtle.importKey("jwk", type === "private" ? curve448PrivateJwk(name) : curve448PublicJwk(name), name, true, usages));
      const wrapper = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ["wrapKey", "unwrapKey"]));
      const cipher = { name: "AES-GCM", iv: new Uint8Array(12) };
      const original = await f.settle(f.subtle.exportKey(format, key));
      const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapper, cipher));
      const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapper, cipher, name, true, usages));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), original);
      if (name === "Ed448") {
        if (type === "private") assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign(name, restored, ed448Message()))), ed448Signature());
        else assert.equal(await f.settle(f.subtle.verify(name, restored, ed448Signature(), ed448Message())), true);
      } else {
        const peer = await f.settle(f.subtle.importKey("jwk", type === "private" ? x448PublicJwk("bob") : x448PrivateJwk("bob"),
          name, false, type === "private" ? [] : ["deriveBits"]));
        const bits = await f.settle(f.subtle.deriveBits({ name, public: type === "public" ? restored : peer }, type === "private" ? restored : peer));
        assert.deepEqual(new Uint8Array(bits), x448Secret());
      }
    });
  }

  test(`AES-KW wraps ${name} JWK and enforces each binary encoding's octet alignment`, async () => {
    const f = fixture();
    const wrapper = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-KW", false, ["wrapKey", "unwrapKey"]));
    for (const type of ["public", "private"] as const) {
      const usages = name === "Ed448" ? [type === "private" ? "sign" : "verify"] : type === "private" ? ["deriveBits"] : [];
      const key = await f.settle(f.subtle.importKey("jwk", type === "private" ? curve448PrivateJwk(name) : curve448PublicJwk(name), name, true, usages));
      const formats = type === "public" ? ["jwk", "raw", "spki"] : ["jwk", "pkcs8"];
      for (const format of formats) {
        const supported = format === "jwk" || (name === "X448" && format !== "spki");
        const pending = f.subtle.wrapKey(format, key, wrapper, "AES-KW");
        if (!supported) { await assert.rejects(f.settle(pending), dom("OperationError")); continue; }
        const wrapped = await f.settle(pending);
        const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapper, "AES-KW", name, true, usages));
        assert.deepEqual(await f.settle(f.subtle.exportKey(format, restored)), await f.settle(f.subtle.exportKey(format, key)));
      }
    }
  });
}
