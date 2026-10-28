// Specification controls: Web Cryptography §§9, 14.3, 15, 27–31.
// https://w3c.github.io/webcrypto/ ; HMAC answers: RFC 2202 §3 / RFC 4231 §4.2.
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createCrypto } from "../src/crypto/crypto.ts";
import { SubtleCrypto } from "../src/crypto/subtle-crypto.ts";
import { createCryptoKey, CryptoKey, getCryptoKeySlots, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import { DOMException } from "../src/core/errors.ts";
import type { RandomSource } from "../src/provider/primitives.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import type {
  CryptoCipherParameters, CryptoCiphertext, CryptoFailure, CryptoKeyComponents,
  CryptoKeyHandle, CryptoKeyImport, CryptoKeyRecord, CryptoSignature, CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class TestRandom implements RandomSource {
  fills = 0;
  lastLength = 0;
  fill(bytes: Uint8Array): void {
    this.fills++;
    this.lastLength = bytes.length;
    bytes.fill(0xff);
  }
}

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  exports = 0;
  componentExports = 0;
  signs = 0;
  verifies = 0;
  encrypts = 0;
  decrypts = 0;
  imported: Uint8Array | undefined;
  signed: Uint8Array | undefined;
  importFailure: CryptoFailure | undefined;
  exportFailure: CryptoFailure | undefined;
  signFailure: CryptoFailure | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    if (input.format === "raw" && input.family === "secret") this.imported = input.bytes;
    return this.importFailure ?? super.importKey(input);
  }
  override exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    this.exports++;
    return this.exportFailure ?? super.exportKey(key, format);
  }
  override exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure {
    this.componentExports++;
    return this.exportFailure ?? super.exportComponents(key);
  }
  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.signed = bytes;
    return this.signFailure ?? super.sign(parameters, key, bytes);
  }
  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, signature: CryptoSignature, bytes: Uint8Array): boolean | CryptoFailure {
    this.verifies++;
    return super.verify(parameters, key, signature, bytes);
  }
  override encrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoCiphertext | CryptoFailure {
    this.encrypts++;
    return super.encrypt(parameters, key, bytes);
  }
  override decrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, bytes: CryptoCiphertext): Uint8Array | CryptoFailure {
    this.decrypts++;
    return super.decrypt(parameters, key, bytes);
  }
}

function fixture(provider = new RecordingProvider()) {
  const random = new TestRandom();
  const scheduler = new VirtualScheduler();
  const subtle = createCrypto(random, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function raw(key: CryptoKey): Promise<Uint8Array> {
    const value = await settle(subtle.exportKey("raw", key));
    assert.ok(value instanceof ArrayBuffer);
    return new Uint8Array(value);
  }
  async function hmac(usages: readonly KeyUsage[] = ["sign", "verify"], extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey("raw", new Uint8Array(20).fill(0x0b), { name: "HMAC", hash: "SHA-256" }, extractable, usages));
  }
  return { subtle, scheduler, random, provider, settle, raw, hmac };
}

function dom(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}
function ascii(text: string): Uint8Array { return new Uint8Array(Buffer.from(text, "ascii")); }
function hex(bytes: ArrayBuffer): string { return Buffer.from(bytes).toString("hex"); }

for (const [hash, expected] of [
  ["SHA-1", "b617318655057264e28bc0b6fb378c8ef146be00"],
  ["SHA-256", "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"],
  ["SHA-384", "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6"],
  ["SHA-512", "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde" +
    "daa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854"],
] as const) {
  test("HMAC " + hash + " signs and verifies the published known answer", async () => {
    const f = fixture();
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(20).fill(0x0b), { name: "hMaC", hash: hash.toLowerCase() }, true, ["verify", "sign", "verify"]));
    assert.deepEqual(key.algorithm, { name: "HMAC", length: 160, hash: { name: hash } });
    assert.deepEqual(key.usages, ["sign", "verify"]);
    const data = ascii("Hi There");
    const signature = await f.settle(f.subtle.sign("HMAC", key, data));
    assert.equal(hex(signature), expected);
    assert.equal(f.provider.signed, data, "the synchronous primitive borrows ordinary input");
    assert.equal(await f.settle(f.subtle.verify("HMAC", key, signature, data)), true);
    const corrupt = new Uint8Array(signature.slice(0)); corrupt[0]! ^= 1;
    assert.equal(await f.settle(f.subtle.verify("HMAC", key, corrupt, data)), false);
    assert.equal(await f.settle(f.subtle.verify("HMAC", key, new Uint8Array(), data)), false);
    assert.equal(await f.settle(f.subtle.verify("HMAC", key, corrupt.subarray(1), data)), false);
    assert.equal(f.provider.signs, 1);
    assert.equal(f.provider.verifies, 4);
  });
}

for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"]) {
  for (const length of [128, 192, 256]) {
    for (const extractable of [false, true]) {
      test(name + " generates " + length + " bits, extractable=" + extractable, async () => {
        const f = fixture();
        const usages: KeyUsage[] = name === "AES-KW" ? ["unwrapKey", "wrapKey", "wrapKey"] : ["unwrapKey", "decrypt", "encrypt", "wrapKey", "encrypt"];
        const key = await f.settle(f.subtle.generateKey({ name, length }, extractable, usages));
        assert.ok(key instanceof CryptoKey);
        assert.equal(key.type, "secret");
        assert.equal(key.extractable, extractable);
        assert.deepEqual(key.algorithm, { name, length });
        assert.deepEqual(key.usages, name === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
        assert.equal(f.random.fills, 1);
        assert.equal(f.random.lastLength, length / 8);
        assert.equal(f.provider.imports, 1);
        if (extractable) assert.deepEqual(await f.raw(key), new Uint8Array(length / 8).fill(0xff));
        else await assert.rejects(f.settle(f.subtle.exportKey("raw", key)), dom("InvalidAccessError"));
      });
    }
    test(name + " raw and JWK imports/exports preserve " + length + " bits", async () => {
      const f = fixture();
      const usages = name === "AES-KW" ? ["wrapKey"] : ["encrypt"];
      const bytes = new Uint8Array(length / 8).fill(0x5a);
      const key = await f.settle(f.subtle.importKey("raw", bytes, name.toLowerCase(), true, usages));
      assert.equal(f.provider.imported, bytes);
      const jwk = await f.settle(f.subtle.exportKey("jwk", key));
      assert.equal(Object.getPrototypeOf(jwk), Object.prototype);
      assert.deepEqual(jwk, { kty: "oct", k: Buffer.from(bytes).toString("base64url"), alg: "A" + length + name.slice(4), key_ops: usages, ext: true });
      assert.equal(f.provider.componentExports, 1);
      const imported = await f.settle(f.subtle.importKey("jwk", jwk, name, true, usages));
      assert.deepEqual(imported.algorithm, key.algorithm);
      assert.deepEqual(await f.raw(imported), bytes);
    });
  }
}

for (const [hash, block] of [["SHA-1", 512], ["SHA-256", 512], ["SHA-384", 1024], ["SHA-512", 1024]] as const) {
  test("HMAC " + hash + " generation uses its block size unless length is present", async () => {
    const f = fixture();
    for (const length of [undefined, 1, 7, 8, 9, 17, 128, 160, 256, 1024]) {
      const key = await f.settle(f.subtle.generateKey({ name: "HMAC", hash, length }, true, ["verify", "sign"]));
      assert.ok(key instanceof CryptoKey);
      const logical = length ?? block;
      assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length: logical });
      const bytes = await f.raw(key);
      assert.equal(bytes.length, Math.ceil(logical / 8));
      assert.equal(bytes.at(-1), logical % 8 === 0 ? 255 : (255 << (8 - logical % 8)) & 255);
      assert.equal(f.random.lastLength, Math.ceil(logical / 8));
    }
  });
}

test("HMAC import preserves logical length and masks only a copied last octet", async () => {
  const f = fixture();
  for (let length = 9; length <= 16; length++) {
    const input = new Uint8Array([0xab, 0xff]);
    const key = await f.settle(f.subtle.importKey("raw", input, { name: "HMAC", hash: "SHA-256", length }, true, ["sign"]));
    assert.deepEqual(input, new Uint8Array([0xab, 0xff]));
    assert.equal((key.algorithm as { name: string; length: number }).length, length);
    assert.deepEqual(await f.raw(key), new Uint8Array([0xab, (255 << ((8 - length % 8) % 8)) & 255]));
  }
  for (const length of [0, 1, 8, 17, 32]) {
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(2), { name: "HMAC", hash: "SHA-256", length }, true, ["sign"])), dom("DataError"));
  }
  await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), { name: "HMAC", hash: "SHA-256" }, true, ["sign"])), dom("DataError"));
});

test("HMAC long octet keys and empty messages use one native signing operation", async () => {
  const f = fixture();
  const input = new Uint8Array(131).fill(0xaa);
  const key = await f.settle(f.subtle.importKey("raw", input, { name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]));
  const message = ascii("Test Using Larger Than Block-Size Key - Hash Key First");
  assert.equal(hex(await f.settle(f.subtle.sign("HMAC", key, message))), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  const signature = await f.settle(f.subtle.sign("HMAC", key, new Uint8Array()));
  assert.equal(await f.settle(f.subtle.verify("HMAC", key, signature, new Uint8Array())), true);
  assert.equal(f.provider.signs, 2);
});

test("key material and cached dictionaries are isolated from later author mutation", async () => {
  const f = fixture();
  const input = new Uint8Array(20).fill(0x0b);
  const pending = f.subtle.importKey("raw", input, { name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
  input.fill(0);
  const key = await f.settle(pending);
  const algorithm = key.algorithm as { name: string; length: number; hash: { name: string } };
  algorithm.name = "AES-GCM"; algorithm.length = 0; algorithm.hash.name = "SHA-1";
  key.usages.length = 0;
  assert.equal(key.algorithm, algorithm);
  assert.equal(hex(await f.settle(f.subtle.sign("HMAC", key, ascii("Hi There")))), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  const bytes = await f.raw(key); bytes.fill(0);
  assert.deepEqual(await f.raw(key), new Uint8Array(20).fill(0x0b));
  const jwk = await f.settle(f.subtle.exportKey("jwk", key));
  assert.ok(!(jwk instanceof ArrayBuffer));
  assert.equal(jwk.alg, "HS256");
  assert.deepEqual(jwk.key_ops, ["sign", "verify"]);
});

test("raw import copies after normalization and consumes exact DataView bytes", async () => {
  const f = fixture();
  const input = new Uint8Array(24).fill(3);
  const key = await f.settle(f.subtle.importKey("raw", new DataView(input.buffer, 4, 16), {
    get name() { input.fill(7, 4, 20); return "AES-GCM"; },
  }, true, ["encrypt"]));
  assert.deepEqual(await f.raw(key), new Uint8Array(16).fill(7));
  const detached = new Uint8Array(16);
  await assert.rejects(f.settle(f.subtle.importKey("raw", detached, {
    get name() { if (!detached.buffer.detached) detached.buffer.transfer(); return "AES-GCM"; },
  }, true, ["encrypt"])), dom("DataError"));
});

test("operation permissions use the hidden slots and do not consult mutable includes", async () => {
  const f = fixture();
  const key = await f.hmac(["verify"]);
  key.usages.push("sign");
  const original = Array.prototype.includes;
  let pending: Promise<ArrayBuffer>;
  try {
    Array.prototype.includes = function () { return true; };
    pending = f.subtle.sign("HMAC", key, new Uint8Array());
  } finally { Array.prototype.includes = original; }
  await assert.rejects(f.settle(pending), dom("InvalidAccessError"));
  assert.equal(f.provider.signs, 0);
});

for (const [label, generateAlgorithm, importAlgorithm, usages, generateError, importError] of [
  ["HMAC zero length wins only on import", { name: "HMAC", hash: "SHA-256", length: 0 }, { name: "HMAC", hash: "SHA-256", length: 0 }, ["encrypt"], "SyntaxError", "DataError"],
  ["HMAC zero valid usages", { name: "HMAC", hash: "SHA-256", length: 0 }, { name: "HMAC", hash: "SHA-256", length: 0 }, ["sign"], "OperationError", "DataError"],
  ["AES invalid length", { name: "AES-GCM", length: 64 }, "AES-GCM", ["encrypt"], "OperationError", "DataError"],
  ["AES invalid usage wins over length", { name: "AES-GCM", length: 64 }, "AES-GCM", ["sign"], "SyntaxError", "SyntaxError"],
  ["KW excludes encrypt", { name: "AES-KW", length: 128 }, "AES-KW", ["encrypt"], "SyntaxError", "SyntaxError"],
] as const) {
  test(label, async () => {
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.generateKey(generateAlgorithm, true, usages)), dom(generateError));
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(8), importAlgorithm, true, usages)), dom(importError));
    assert.equal(f.provider.imports, 0);
    assert.equal(f.random.fills, 0);
  });
}

test("empty secret usages reject after key creation, preserving earlier errors", async () => {
  const f = fixture();
  await assert.rejects(f.settle(f.subtle.generateKey({ name: "AES-CBC", length: 128 }, true, [])), dom("SyntaxError"));
  assert.equal(f.random.fills, 1);
  assert.equal(f.provider.imports, 1);
  await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-CBC", false, [])), dom("SyntaxError"));
  assert.equal(f.provider.imports, 2);
  await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(3), "AES-CBC", false, [])), dom("DataError"));
  assert.equal(f.provider.imports, 2);
});

const validJwk = { kty: "oct", k: "CwsLCwsLCwsLCwsLCwsLCwsLCws", alg: "HS256", key_ops: ["sign", "verify"], ext: true };
for (const [label, changes] of [
  ["wrong kty", { kty: "RSA" }], ["missing k", { k: undefined }], ["padded k", { k: "Cw==" }],
  ["invalid k alphabet", { k: "+/8" }], ["empty k", { k: "" }], ["hash mismatch", { alg: "HS1" }],
  ["wrong use", { use: "enc" }], ["duplicate operations", { key_ops: ["sign", "sign"] }],
  ["absent requested operation", { key_ops: ["verify"] }], ["inconsistent use/operations", { use: "sig", key_ops: ["sign", "encrypt"] }],
  ["nonextractable", { ext: false }],
] as const) {
  test("HMAC JWK rejects " + label, async () => {
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...validJwk, ...changes }, { name: "HMAC", hash: "SHA-256" }, true, ["sign"])), dom("DataError"));
    assert.equal(f.provider.imports, 0);
  });
}

test("JWK permits omitted policy, unknown extra operations and nonextractable imports", async () => {
  const f = fixture();
  const key = await f.settle(f.subtle.importKey("jwk", { kty: "oct", k: validJwk.k, key_ops: ["vendor-operation", "sign"], ext: false, ignored: 42 }, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  assert.equal(key.extractable, false);
  assert.deepEqual(key.usages, ["sign"]);
  assert.ok(await f.settle(f.subtle.sign("HMAC", key, new Uint8Array())));
});

test("export checks registered algorithm before extractability and format support", async () => {
  const f = fixture();
  const fake = createCryptoKey("secret", false, new KeyAlgorithm("future"), ["sign"], {} as CryptoKeyHandle);
  await assert.rejects(f.settle(f.subtle.exportKey("raw", fake)), dom("NotSupportedError"));
  const hidden = await f.hmac(["sign"], false);
  await assert.rejects(f.settle(f.subtle.exportKey("spki", hidden)), dom("InvalidAccessError"));
  const key = await f.hmac();
  for (const format of ["spki", "pkcs8"]) {
    await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("NotSupportedError"));
    await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(20), { name: "HMAC", hash: "SHA-256" }, true, ["sign"])), dom("NotSupportedError"));
  }
});

for (const failure of ["invalid-key", "operation"] as const) {
  test("native " + failure + " failure values map at the shared operation boundary", async () => {
    const f = fixture();
    f.provider.importFailure = { failure };
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt"])), dom("OperationError"));
    f.provider.importFailure = undefined;
    const key = await f.hmac();
    f.provider.exportFailure = { failure };
    for (const format of ["raw", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
    f.provider.signFailure = { failure };
    await assert.rejects(f.settle(f.subtle.sign("HMAC", key, new Uint8Array())), dom("OperationError"));
  });
}

test("import rejects inconsistent native metadata rather than exposing a mislabeled key", async () => {
  class WrongMetadata extends RecordingProvider {
    override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
      const result = super.importKey(input);
      if ("failure" in result) return result;
      return { handle: result.handle, info: { family: "secret", type: "secret", length: 256 } };
    }
  }
  const f = fixture(new WrongMetadata());
  await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"])), dom("OperationError"));
});

test("all item2 methods reject invalid receivers and missing arguments as promises", async () => {
  const methods = ["encrypt", "decrypt", "sign", "verify", "generateKey", "importKey", "exportKey", "wrapKey", "unwrapKey"] as const;
  const f = fixture();
  for (const method of methods) {
    for (const receiver of [null, {}, SubtleCrypto.prototype]) {
      const pending = Reflect.apply(SubtleCrypto.prototype[method], receiver, []);
      assert.ok(pending instanceof Promise);
      await assert.rejects(pending, TypeError);
    }
    await assert.rejects(Reflect.apply(f.subtle[method], f.subtle, []), TypeError);
  }
});

test("import IDL conversions precede normalization and format/data consistency", async () => {
  const f = fixture();
  const reads: string[] = [];
  const data = { get kty() { reads.push("kty"); return "oct"; }, get k() { reads.push("k"); return validJwk.k; } };
  const algorithm = { get name() { reads.push("name"); return "HMAC"; }, get hash() { reads.push("hash"); return "SHA-256"; } };
  const usages = { *[Symbol.iterator]() { reads.push("usages"); yield "sign"; } };
  await assert.rejects(f.subtle.importKey("raw", data, algorithm, true, usages), TypeError);
  assert.deepEqual(reads, ["k", "kty", "usages", "name", "name", "hash"]);
  reads.length = 0;
  await assert.rejects(f.subtle.importKey("invalid", data, algorithm, true, usages), TypeError);
  assert.deepEqual(reads, []);
  await assert.rejects(f.subtle.importKey("jwk", new Uint8Array(16), "unknown", true, ["sign"]), dom("NotSupportedError"));
  await assert.rejects(f.subtle.importKey("jwk", new Uint8Array(16), algorithm, true, ["sign"]), TypeError);
});

test("IDL rejects shared/resizable views before algorithm getters and permits bare shared dictionary fallback", async () => {
  const f = fixture();
  let reads = 0;
  const algorithm = { get name() { reads++; return "AES-GCM"; } };
  for (const data of [new Uint8Array(new SharedArrayBuffer(16)), new ArrayBuffer(16, { maxByteLength: 32 }), new DataView(new ArrayBuffer(16, { maxByteLength: 32 }))]) {
    await assert.rejects(f.subtle.importKey("raw", data, algorithm, true, ["encrypt"]), TypeError);
  }
  assert.equal(reads, 0);
  await assert.rejects(f.settle(f.subtle.importKey("jwk", new SharedArrayBuffer(16), algorithm, true, ["encrypt"])), dom("DataError"));
  assert.equal(reads, 2);
});

test("early normalization failures reject without a task; key-policy failures use one task", async () => {
  const f = fixture();
  const key = await f.hmac(["verify"]);
  let early = false;
  const first = f.subtle.sign("unknown", key, new Uint8Array()).catch(() => { early = true; });
  await Promise.resolve();
  assert.equal(early, true);
  await first;
  let later = false;
  const second = f.subtle.sign("HMAC", key, new Uint8Array()).catch(() => { later = true; });
  await Promise.resolve();
  assert.equal(later, false);
  f.scheduler.runPending();
  await second;
  assert.equal(later, true);
});

const wrappingAlgorithms = [
  { name: "AES-CTR", counter: new Uint8Array(16), length: 128 },
  { name: "AES-CBC", iv: new Uint8Array(16) },
  { name: "AES-GCM", iv: new Uint8Array(12), additionalData: ascii("context"), tagLength: 96 },
  { name: "AES-KW" },
];
for (const algorithm of wrappingAlgorithms) {
  for (const format of ["raw", "jwk"]) {
    test(algorithm.name + " wraps and unwraps " + format + " using wrapping-only permissions", async () => {
      const f = fixture();
      const wrapping = await f.settle(f.subtle.generateKey({ name: algorithm.name, length: 128 }, false, ["wrapKey", "unwrapKey"]));
      const source = await f.hmac();
      // RFC3394 needs an octet count divisible by eight; use 16 HMAC octets for raw.
      const key = format === "raw"
        ? await f.settle(f.subtle.importKey("raw", new Uint8Array(16).fill(7), { name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"])) : source;
      const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm));
      const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, algorithm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
      assert.equal(restored.extractable, false);
      assert.deepEqual(restored.usages, ["sign"]);
      assert.deepEqual(await f.settle(f.subtle.sign("HMAC", restored, ascii("message"))), await f.settle(f.subtle.sign("HMAC", key, ascii("message"))));
      assert.equal(f.provider.encrypts, 1);
      assert.equal(f.provider.decrypts, 1);
      await assert.rejects(f.settle(f.subtle.encrypt(algorithm, wrapping, new Uint8Array())), dom(algorithm.name === "AES-KW" ? "NotSupportedError" : "InvalidAccessError"));
    });
  }
}

test("wrapping checks wrapping permissions before the exported key", async () => {
  const f = fixture();
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt"]));
  const unknown = createCryptoKey("secret", false, new KeyAlgorithm("future"), [], {} as CryptoKeyHandle);
  await assert.rejects(f.settle(f.subtle.wrapKey("raw", unknown, wrapping, algorithm)), dom("InvalidAccessError"));
  const permitted = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["wrapKey"]));
  await assert.rejects(f.settle(f.subtle.wrapKey("raw", unknown, permitted, algorithm)), dom("NotSupportedError"));
  const hidden = await f.hmac(["sign"], false);
  await assert.rejects(f.settle(f.subtle.wrapKey("raw", hidden, permitted, algorithm)), dom("InvalidAccessError"));
  assert.equal(f.provider.encrypts, 0);
});

test("wrap and unwrap retry normalization after an author getter throws", async () => {
  const f = fixture();
  const key = await f.hmac();
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["wrapKey", "unwrapKey"]));
  let reads = 0;
  const algorithm = { get name() { if (++reads === 1) throw new Error("first normalization"); return "AES-GCM"; }, iv: new Uint8Array(12) };
  const wrapped = await f.settle(f.subtle.wrapKey("raw", key, wrapping, algorithm));
  assert.equal(reads, 3);
  reads = 0;
  const restored = await f.settle(f.subtle.unwrapKey("raw", wrapped, wrapping, algorithm, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]));
  assert.equal(reads, 3);
  assert.deepEqual(await f.raw(restored), await f.raw(key));
});

test("unwrap snapshots algorithm buffers before the second algorithm runs author code", async () => {
  const f = fixture();
  const key = await f.hmac();
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["wrapKey", "unwrapKey"]));
  const iv = new Uint8Array(12).fill(1);
  const aad = new Uint8Array([2, 3]);
  const wrapped = await f.settle(f.subtle.wrapKey("raw", key, wrapping, { name: "AES-GCM", iv, additionalData: aad }));
  const restored = await f.settle(f.subtle.unwrapKey("raw", wrapped, wrapping, { name: "AES-GCM", iv, additionalData: aad }, {
    get name() { iv.fill(9); aad.fill(8); return "HMAC"; }, hash: "SHA-256",
  }, true, ["sign"]));
  assert.deepEqual(await f.raw(restored), await f.raw(key));
});

test("unwrap obeys JWK ext and syntax/dictionary failures after successful decryption", async () => {
  const f = fixture();
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "unwrapKey"]));
  for (const [text, error] of [
    ['{"kty":"oct","k":"CwsLCwsLCwsLCwsLCwsLCwsLCws","ext":false}', "DataError"],
    ["{}", "DataError"], ["not JSON", "SyntaxError"], ['{"kty":"oct","key_ops":null}', "TypeError"],
  ] as const) {
    const wrapped = await f.settle(f.subtle.encrypt(algorithm, wrapping, ascii(text)));
    const pending = f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]));
    if (error === "SyntaxError") await assert.rejects(pending, SyntaxError);
    else if (error === "TypeError") await assert.rejects(pending, TypeError);
    else await assert.rejects(pending, dom(error));
  }
});

test("HMAC can verify through a distinct compatible provider without exposing handles", async () => {
  const first = fixture();
  const second = fixture();
  const key = await first.hmac();
  const data = ascii("portable opaque handle");
  const signature = await first.settle(first.subtle.sign("HMAC", key, data));
  assert.equal(await second.settle(second.subtle.verify("HMAC", key, signature, data)), true);
  assert.equal(Object.getOwnPropertySymbols(key).length, 0);
  assert.equal(Object.getOwnPropertyNames(key).length, 0);
  assert.equal(getCryptoKeySlots(key).algorithm.name, "HMAC");
  assert.equal(hex(signature), createHmac("sha256", new Uint8Array(20).fill(0x0b)).update(data).digest("hex"));
});

test("public key algorithms and JWK objects use Web IDL member order", async () => {
  const f = fixture();
  const key = await f.hmac();
  assert.deepEqual(Object.keys(key.algorithm), ["name", "hash", "length"]);
  assert.deepEqual(Object.keys(await f.settle(f.subtle.exportKey("jwk", key))), ["alg", "ext", "k", "key_ops", "kty"]);
});

test("key generation cannot be redirected by a replacement Math.ceil", async () => {
  const f = fixture();
  const original = Math.ceil;
  let pending: ReturnType<SubtleCrypto["generateKey"]>;
  try {
    pending = f.subtle.generateKey({
      get name() { Math.ceil = () => 0; return "HMAC"; }, hash: "SHA-256", length: 17,
    }, true, ["sign"]);
  } finally { Math.ceil = original; }
  const key = await f.settle(pending);
  assert.ok(key instanceof CryptoKey);
  assert.equal(f.random.lastLength, 3);
  assert.deepEqual(await f.raw(key), new Uint8Array([255, 255, 128]));
});

test("wrapping never invokes inherited toJSON hooks", async () => {
  const f = fixture();
  const key = await f.hmac();
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["wrapKey", "unwrapKey"]));
  const iv = new Uint8Array(12);
  let calls = 0;
  const objectDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const arrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  let pending: Promise<ArrayBuffer>;
  try {
    const hook = () => { calls++; iv.fill(7); throw new Error("toJSON must not run"); };
    Object.defineProperty(Object.prototype, "toJSON", { value: hook, configurable: true });
    Object.defineProperty(Array.prototype, "toJSON", { value: hook, configurable: true });
    pending = f.subtle.wrapKey("jwk", key, wrapping, { name: "AES-GCM", iv });
  } finally {
    if (objectDescriptor === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
    else Object.defineProperty(Object.prototype, "toJSON", objectDescriptor);
    if (arrayDescriptor === undefined) delete (Array.prototype as { toJSON?: unknown }).toJSON;
    else Object.defineProperty(Array.prototype, "toJSON", arrayDescriptor);
  }
  const wrapped = await f.settle(pending);
  assert.equal(calls, 0);
  const restored = await f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, { name: "AES-GCM", iv }, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]));
  assert.deepEqual(await f.raw(restored), await f.raw(key));
});

test("verify consumes signature and data only after algorithm normalization", async () => {
  const f = fixture();
  const key = await f.hmac();
  const expectedData = ascii("Hi There");
  const expected = await f.settle(f.subtle.sign("HMAC", key, expectedData));
  const signature = new Uint8Array(32);
  const data = new Uint8Array(expectedData.length);
  const pending = f.subtle.verify({
    get name() { signature.set(new Uint8Array(expected)); data.set(expectedData); return "HMAC"; },
  }, key, signature, data);
  signature.fill(0); data.fill(0);
  assert.equal(await f.settle(pending), true);
});

test("key and buffer IDL conversions precede algorithm getters for operations", async () => {
  const f = fixture();
  const key = await f.hmac();
  let reads = 0;
  const algorithm = { get name() { reads++; return "HMAC"; } };
  await assert.rejects(f.subtle.sign(algorithm, {}, new Uint8Array()), TypeError);
  await assert.rejects(f.subtle.sign(algorithm, key, {}), TypeError);
  await assert.rejects(f.subtle.verify(algorithm, key, new Uint8Array(), {}), TypeError);
  assert.equal(reads, 0);
  assert.equal(f.provider.signs, 0);
  assert.equal(f.provider.verifies, 0);
});

test("Promise helper replacements cannot run after input borrowing or alter early rejection", async () => {
  const f = fixture();
  const key = await f.hmac();
  const data = ascii("Hi There");
  const originalResolvers = Promise.withResolvers;
  const originalReject = Promise.reject;
  let calls = 0;
  let pending: Promise<ArrayBuffer>;
  let failed: Promise<ArrayBuffer>;
  const sentinel = new Error("normalization failure");
  try {
    pending = f.subtle.sign({ get name() {
      Promise.withResolvers = (() => { calls++; data.fill(0); return originalResolvers.call(Promise); }) as typeof Promise.withResolvers;
      return "HMAC";
    } }, key, data);
    failed = f.subtle.sign({ get name() {
      Promise.reject = (() => { calls++; throw new Error("replacement reject must not run"); }) as typeof Promise.reject;
      throw sentinel;
    } }, key, data);
  } finally {
    Promise.withResolvers = originalResolvers;
    Promise.reject = originalReject;
  }
  await assert.rejects(failed, (error) => error === sentinel);
  assert.equal(hex(await f.settle(pending)), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  assert.equal(calls, 0);
});

test("WeakMap prototype changes cannot capture hidden CryptoKey state", async () => {
  const f = fixture();
  const key = await f.hmac();
  const originalGet = WeakMap.prototype.get;
  const originalSet = WeakMap.prototype.set;
  const captured: unknown[] = [];
  try {
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
      captured.push(this);
      return originalGet.call(this, key);
    };
    WeakMap.prototype.set = function (this: WeakMap<object, unknown>, key: object, value: unknown) {
      captured.push(value);
      return originalSet.call(this, key, value);
    };
    assert.equal(key.type, "secret");
    assert.equal(key.extractable, true);
    assert.equal(key.algorithm.name, "HMAC");
    assert.deepEqual(key.usages, ["sign", "verify"]);
    const other = createCryptoKey("secret", false, new KeyAlgorithm("HMAC"), ["sign"], {} as CryptoKeyHandle);
    assert.equal(other.type, "secret");
  } finally {
    WeakMap.prototype.get = originalGet;
    WeakMap.prototype.set = originalSet;
  }
  assert.deepEqual(captured, []);
});

test("borrowed CBC data cannot invoke a replacement intrinsic call property", async () => {
  const f = fixture();
  const key = await f.settle(f.subtle.generateKey({ name: "AES-CBC", length: 128 }, true, ["encrypt", "decrypt"]));
  const bytes = new Uint8Array([1, 2, 3]);
  const setter = Uint8Array.prototype.set;
  const descriptor = Object.getOwnPropertyDescriptor(setter, "call");
  let calls = 0;
  let pending: Promise<ArrayBuffer>;
  try {
    pending = f.subtle.encrypt({ get name() {
      Object.defineProperty(setter, "call", { value() { calls++; throw new Error("must not call author hook"); }, configurable: true });
      return "AES-CBC";
    }, iv: new Uint8Array(16) }, key, bytes);
  } finally {
    if (descriptor === undefined) delete (setter as { call?: unknown }).call;
    else Object.defineProperty(setter, "call", descriptor);
  }
  const encrypted = await f.settle(pending);
  assert.equal(calls, 0);
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, encrypted))), bytes);
});
