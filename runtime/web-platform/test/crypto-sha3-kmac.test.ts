// Modern Algorithms §§2.1, 3.1.1, 12, 13 and 16:
// https://wicg.github.io/webcrypto-modern-algos/
import assert from "node:assert/strict";
import { createHash, createHmac, hkdfSync } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { CShakeParams, KmacImportParams, KmacParams, normalizeAlgorithm, normalizeHashAlgorithm } from "../src/crypto/algorithms.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey } from "../src/crypto/crypto-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type { CryptoCshakeParameters, CryptoFailure, CryptoKeyHandle, CryptoSignature, CryptoSignatureParameters } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));
const dom = (name: string) => (error: unknown): boolean => error instanceof DOMException && error.name === name;
const sampleKey = new Uint8Array(32).map((_, index) => 0x40 + index);
const sampleData = new Uint8Array([0, 1, 2, 3]);
const sampleMac = bytes("e5780b0d3ea6f7d3a429c5706aa43a00fadbd7d49628839e3187243f456ee14e");

class RecordingProvider extends NodeCryptoProvider {
  signs = 0;
  verifies = 0;
  xofs = 0;
  parameters: CryptoSignatureParameters | CryptoCshakeParameters | undefined;
  fail = false;
  override digestXof(parameters: CryptoCshakeParameters, data: Uint8Array): Uint8Array | CryptoFailure {
    this.xofs++;
    this.parameters = parameters;
    return this.fail ? { failure: "operation" } : super.digestXof(parameters, data);
  }
  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.parameters = parameters;
    return this.fail ? { failure: "operation" } : super.sign(parameters, key, data);
  }
  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, signature: CryptoSignature, data: Uint8Array): boolean | CryptoFailure {
    this.verifies++;
    this.parameters = parameters;
    return this.fail ? { failure: "operation" } : super.verify(parameters, key, signature, data);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  let randomCalls = 0;
  const subtle = createCrypto({ fill(value) { randomCalls++; value.fill(0xff); } }, provider, scheduler).subtle;
  const settle = <T>(promise: Promise<T>): Promise<T> => { scheduler.runPending(); return promise; };
  const key = (name = "KMAC128", length?: number) => settle(subtle.importKey("raw-secret", sampleKey, { name, length }, true, ["sign", "verify"]));
  return { provider, scheduler, subtle, settle, key, randomCalls: () => randomCalls };
}

for (const [name, expected] of [
  ["SHA3-256", "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"],
  ["SHA3-384", "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004"],
  ["SHA3-512", "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26"],
] as const) {
  test(name + " matches FIPS 202's empty-message digest and observes the view range", async () => {
    const f = fixture();
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.digest(name.toLowerCase(), new Uint8Array(0)))), bytes(expected));
    const data = new Uint8Array([9, 1, 2, 3, 9]);
    const result = f.subtle.digest({ name }, new DataView(data.buffer, 1, 3));
    data.fill(0);
    assert.deepEqual(new Uint8Array(await f.settle(result)), new Uint8Array(createHash(name).update(new Uint8Array([1, 2, 3])).digest()));
  });
}

for (const name of ["cSHAKE128", "cSHAKE256"] as const) {
  test(name + " uses native SHAKE for empty N/S, including zero and partial octets", async () => {
    const f = fixture();
    for (const length of [0, 1, 7, 8, 9, 256]) {
      const expected = new Uint8Array(createHash(name === "cSHAKE128" ? "shake128" : "shake256", { outputLength: Math.ceil(length / 8) }).update(sampleData).digest());
      if (length % 8 !== 0) expected[expected.length - 1]! &= (1 << (length % 8)) - 1;
      const result = await f.settle(f.subtle.digest({ name, outputLength: length }, sampleData));
      assert.deepEqual(new Uint8Array(result), expected);
      assert.equal(result.byteLength, Math.ceil(length / 8));
    }
    assert.equal(f.provider.xofs, 6);
  });
}

test("cSHAKE128 NIST Email Signature example and Keccak low-bit encoding use native jobs", async () => {
  const f = fixture();
  const customization = new Uint8Array(Buffer.from("Email Signature"));
  const algorithm = { name: "cSHAKE128", outputLength: 256, customization };
  const full = await f.settle(f.subtle.digest(algorithm, sampleData));
  assert.deepEqual(new Uint8Array(full), bytes("c1c36925b6409a04f1b504fcbca9d82b4017277cb5ed2b2065fc1d3814d5aaf5"));
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.digest({ ...algorithm, outputLength: 9 }, sampleData))), new Uint8Array([0xc1, 1]));
  const other = await f.settle(f.subtle.digest({ ...algorithm, functionName: new Uint8Array([1]) }, sampleData));
  assert.notDeepEqual(other, full);
  const before = new Uint8Array(full);
  customization.fill(0);
  assert.deepEqual(new Uint8Array(full), before);
});

test("modern dictionary reads, EnforceRange conversion and explicit snapshots follow their declaration order", () => {
  const order: string[] = [];
  const fn = new Uint8Array([1]);
  const custom = new Uint8Array([2]);
  const normalized = normalizeAlgorithm({
    get name() { order.push("name"); return "cshake128"; },
    get customization() { order.push("customization"); return custom; },
    get functionName() { order.push("functionName"); return fn; },
    get outputLength() { order.push("outputLength"); fn[0] = 3; return 9.9; },
  }, "digest", true);
  assert.ok(normalized instanceof CShakeParams);
  assert.deepEqual(order, ["name", "name", "customization", "functionName", "outputLength"]);
  assert.equal(normalized.outputLength, 9);
  assert.deepEqual(normalized.functionName, new Uint8Array([3]));
  fn[0] = 4;
  assert.deepEqual(normalized.functionName, new Uint8Array([3]));
  assert.ok(normalizeAlgorithm({ name: "KMAC256" }, "importKey") instanceof KmacImportParams);
  assert.ok(normalizeAlgorithm({ name: "KMAC256", outputLength: 0 }, "sign") instanceof KmacParams);
  for (const outputLength of [undefined, -1, Infinity, NaN, 2 ** 32, 1n]) {
    assert.throws(() => normalizeAlgorithm({ name: "cSHAKE128", outputLength }, "digest"), TypeError);
    assert.throws(() => normalizeAlgorithm({ name: "KMAC128", outputLength }, "sign"), TypeError);
  }
  assert.throws(() => normalizeHashAlgorithm({ name: "cSHAKE128", outputLength: 256 }), dom("NotSupportedError"));
});

for (const name of ["KMAC128", "KMAC256"] as const) {
  test(name + " generation preserves defaults, zero-length and partial-octet metadata", async () => {
    const f = fixture();
    for (const length of [undefined, 0, 1, 7, 9, 128]) {
      const key = await f.settle(f.subtle.generateKey({ name, length }, true, ["verify", "sign", "sign"])) as CryptoKey;
      const bits = length ?? (name === "KMAC128" ? 128 : 256);
      assert.deepEqual(key.algorithm, { name, length: bits });
      assert.deepEqual(key.usages, ["sign", "verify"]);
      const raw = await f.settle(f.subtle.exportKey("raw-secret", key)) as ArrayBuffer;
      assert.equal(raw.byteLength, Math.ceil(bits / 8));
      if (bits % 8 !== 0) assert.equal(new Uint8Array(raw).at(-1), (1 << (bits % 8)) - 1);
    }
    assert.equal(f.randomCalls(), 6);
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, ["encrypt"])), dom("SyntaxError"));
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, [])), dom("SyntaxError"));
  });

  test(name + " imports raw-secret and JWK, checks policy and owns partial key bytes", async () => {
    const f = fixture();
    const source = new Uint8Array([0xff]);
    const key = await f.settle(f.subtle.importKey("raw-secret", source, { name, length: 3 }, true, ["sign"]));
    source[0] = 0;
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.exportKey("raw-secret", key)) as ArrayBuffer), new Uint8Array([7]));
    const jwk = await f.settle(f.subtle.exportKey("jwk", key)) as JsonWebKeyObject;
    assert.deepEqual(jwk, { kty: "oct", k: "Bw", alg: name === "KMAC128" ? "K128" : "K256", key_ops: ["sign"], ext: true });
    const roundtrip = await f.settle(f.subtle.importKey("jwk", jwk, { name, length: 3 }, true, ["sign"]));
    assert.deepEqual(roundtrip.algorithm, { name, length: 3 });
    for (const bad of [{ ...jwk, alg: "HS256" }, { ...jwk, use: "enc" }, { ...jwk, ext: false }, { ...jwk, key_ops: ["sign", "sign"] }]) {
      await assert.rejects(f.settle(f.subtle.importKey("jwk", bad, name, true, ["sign"])), dom("DataError"));
    }
    for (const length of [0, 9]) await assert.rejects(f.settle(f.subtle.importKey("raw-secret", new Uint8Array(1), { name, length }, false, ["sign"])), dom("DataError"));
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(1), name, false, ["sign"])), dom("NotSupportedError"));
    await assert.rejects(f.settle(f.subtle.exportKey("raw", key)), dom("NotSupportedError"));
  });

  test(name + " zero-bit signatures verify, byte-oriented output is explicit and native errors reject", async () => {
    const f = fixture();
    const key = await f.key(name);
    const empty = await f.settle(f.subtle.sign({ name, outputLength: 0 }, key, sampleData));
    assert.equal(empty.byteLength, 0);
    assert.equal(await f.settle(f.subtle.verify({ name, outputLength: 0 }, key, empty, sampleData)), true);
    assert.equal(await f.settle(f.subtle.verify({ name, outputLength: 0 }, key, new Uint8Array([1]), sampleData)), false);
    const before = f.provider.signs + f.provider.verifies;
    for (const outputLength of [1, 7, 9, 255]) {
      await assert.rejects(f.settle(f.subtle.sign({ name, outputLength }, key, sampleData)), dom("NotSupportedError"));
      await assert.rejects(f.settle(f.subtle.verify({ name, outputLength }, key, empty, sampleData)), dom("NotSupportedError"));
    }
    assert.equal(f.provider.signs + f.provider.verifies, before);
    f.provider.fail = true;
    await assert.rejects(f.settle(f.subtle.sign({ name, outputLength: 256 }, key, sampleData)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.verify({ name, outputLength: 256 }, key, sampleMac, sampleData)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.digest({ name: "cSHAKE128", outputLength: 256 }, sampleData)), dom("OperationError"));
  });
}

test("KMAC128 NIST sample uses one complete native operation and does not alias inputs", async () => {
  const f = fixture();
  const key = await f.key();
  const data = new Uint8Array(sampleData);
  const signing = f.subtle.sign({ name: "KMAC128", outputLength: 256 }, key, data);
  data.fill(0);
  const signature = await f.settle(signing);
  assert.deepEqual(new Uint8Array(signature), sampleMac);
  assert.equal(f.provider.signs, 1);
  assert.equal(await f.settle(f.subtle.verify({ name: "KMAC128", outputLength: 256 }, key, signature, sampleData)), true);
  const signatureBytes = new Uint8Array(signature);
  signatureBytes[0] = signatureBytes[0]! ^ 1;
  assert.equal(await f.settle(f.subtle.verify({ name: "KMAC128", outputLength: 256 }, key, signature, sampleData)), false);
  assert.equal(await f.settle(f.subtle.verify({ name: "KMAC128", outputLength: 512 }, key, sampleMac, sampleData)), false);
});

test("KMAC deriveKey and wrapping use raw-secret internally without public-method dispatch", async () => {
  const f = fixture();
  const base = await f.settle(f.subtle.importKey("raw-secret", sampleKey, "HKDF", false, ["deriveKey"]));
  let publicCalls = 0;
  f.subtle.importKey = () => { publicCalls++; throw new Error("public importKey override"); };
  f.subtle.encrypt = () => { publicCalls++; throw new Error("public encrypt override"); };
  f.subtle.decrypt = () => { publicCalls++; throw new Error("public decrypt override"); };
  const key = await f.settle(f.subtle.deriveKey({ name: "HKDF", hash: "SHA3-256", salt: new Uint8Array(0), info: sampleData }, base, "KMAC128", true, ["sign", "verify"]));
  const raw = await f.settle(f.subtle.exportKey("raw-secret", key)) as ArrayBuffer;
  assert.deepEqual(raw, hkdfSync("sha3-256", sampleKey, new Uint8Array(0), sampleData, 16));
  const wrapping = await f.settle(f.subtle.generateKey({ name: "AES-KW", length: 128 }, false, ["wrapKey", "unwrapKey"])) as CryptoKey;
  const wrapped = await f.settle(f.subtle.wrapKey("raw-secret", key, wrapping, "AES-KW"));
  const unwrapped = await f.settle(f.subtle.unwrapKey("raw-secret", wrapped, wrapping, "AES-KW", "KMAC128", true, ["sign", "verify"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw-secret", unwrapped)), raw);
  assert.equal(publicCalls, 0);
});

test("native cSHAKE/KMAC parameter ceilings are failures without shared arbitrary limits", async () => {
  const f = fixture();
  const key = await f.key();
  const customization = new Uint8Array(513);
  await assert.rejects(f.settle(f.subtle.digest({ name: "cSHAKE128", outputLength: 8, customization }, sampleData)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.sign({ name: "KMAC128", outputLength: 8, customization }, key, sampleData)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.verify({ name: "KMAC128", outputLength: 8, customization }, key, sampleData, sampleData)), dom("OperationError"));
  const oversized = await f.settle(f.subtle.importKey("raw-secret", new Uint8Array(513), "KMAC128", false, ["sign"]));
  await assert.rejects(f.settle(f.subtle.sign({ name: "KMAC128", outputLength: 8 }, oversized, sampleData)), dom("OperationError"));
  assert.equal(getCryptoKeySlots(oversized).algorithm.name, "KMAC128");
});

test("SHA3 HMAC requires explicit generation length and rejects native verification errors", async () => {
  const f = fixture();
  for (const [hash, length] of [["SHA3-256", 1088], ["SHA3-384", 832], ["SHA3-512", 576]] as const) {
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "HMAC", hash }, true, ["sign"])), dom("NotSupportedError"));
    const key = await f.settle(f.subtle.generateKey({ name: "HMAC", hash, length }, true, ["sign", "verify"])) as CryptoKey;
    assert.deepEqual(key.algorithm, { name: "HMAC", hash: { name: hash }, length });
    const raw = await f.settle(f.subtle.exportKey("raw-secret", key)) as ArrayBuffer;
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.sign("HMAC", key, sampleData))), new Uint8Array(createHmac(hash, new Uint8Array(raw)).update(sampleData).digest()));
    f.provider.fail = true;
    await assert.rejects(f.settle(f.subtle.verify("HMAC", key, sampleMac, sampleData)), dom("OperationError"));
    f.provider.fail = false;
  }
});
