// Web Cryptography §§33.4.1 and 34.4.1: https://w3c.github.io/webcrypto/
// RFC 5869 Appendix A and RFC 6070 §2 answers live in kdf-fixtures.ts.
// Node primitives supply the provider; no Node WebCrypto is used.
import assert from "node:assert/strict";
import { hkdfSync, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import type { KdfAlgorithmName } from "../src/crypto/algorithms.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoDerivationParameters, CryptoDigestName, CryptoFailure, CryptoKeyHandle,
  CryptoSignature, CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { hkdfFixture, pbkdf2Fixture } from "./kdf-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  digests = 0;
  signs = 0;
  parameters: CryptoDerivationParameters | undefined;
  key: CryptoKeyHandle | undefined;
  failure: CryptoFailure | undefined;
  result: Uint8Array | undefined;
  nativeResult: Uint8Array | undefined;

  override digest(name: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.digests++;
    return super.digest(name, bytes);
  }
  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    return super.sign(parameters, key, bytes);
  }
  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    this.parameters = parameters;
    this.key = key;
    const result = this.failure ?? this.result ?? super.derive(parameters, key);
    this.nativeResult = "failure" in result ? undefined : result;
    return result;
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const subtle = new Crypto({ fill(bytes: Uint8Array): void { bytes.fill(0x37); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: KdfAlgorithmName, bytes: Uint8Array = new Uint8Array([1, 2, 3]), usages: readonly KeyUsage[] = ["deriveBits"]): Promise<CryptoKey> {
    return settle(subtle.importKey("raw", bytes, name, false, usages));
  }
  return { provider, scheduler, subtle, settle, key };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function parameters(name: KdfAlgorithmName, hash: CryptoDigestName = "SHA-256") {
  return name === "HKDF"
    ? { name, hash, salt: new Uint8Array([4, 5]), info: new Uint8Array([6, 7]) }
    : { name, hash, salt: new Uint8Array([4, 5]), iterations: 2 };
}

const names: readonly KdfAlgorithmName[] = ["HKDF", "PBKDF2"];
const hashes: readonly CryptoDigestName[] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];

for (let index = 0; index < 7; index++) {
  test(`HKDF derives RFC 5869 Appendix A.${index + 1} through one whole-input primitive`, async () => {
    const f = fixture();
    const vector = hkdfFixture(index);
    const key = await f.key("HKDF", vector.key);
    const algorithm = { name: "HKDF", hash: vector.hash, salt: vector.salt, info: vector.info };
    const result = await f.settle(f.subtle.deriveBits(algorithm, key, vector.length * 8));
    assert.deepEqual(new Uint8Array(result), vector.output);
    assert.equal(result.byteLength, vector.length);
    assert.equal(f.provider.derives, 1);
    assert.equal(f.provider.digests, 0);
    assert.equal(f.provider.signs, 0);
    assert.equal(f.provider.key, getCryptoKeySlots(key).handle);
    assert.deepEqual(f.provider.parameters, { name: "HKDF", hash: vector.hash, salt: vector.salt, info: vector.info, byteLength: vector.length });
    assert.equal(result, f.provider.nativeResult!.buffer);
  });
}

for (let index = 0; index < 5; index++) {
  test(`PBKDF2 derives RFC 6070 answer ${index + 1} through one whole-input primitive`, async () => {
    const f = fixture();
    const vector = pbkdf2Fixture(index);
    const key = await f.key("PBKDF2", vector.key);
    const algorithm = { name: "PBKDF2", hash: vector.hash, salt: vector.salt, iterations: vector.iterations };
    const result = await f.settle(f.subtle.deriveBits(algorithm, key, vector.length * 8));
    assert.deepEqual(new Uint8Array(result), vector.output);
    assert.equal(result.byteLength, vector.length);
    assert.equal(f.provider.derives, 1);
    assert.equal(f.provider.digests, 0);
    assert.equal(f.provider.signs, 0);
    assert.equal(f.provider.key, getCryptoKeySlots(key).handle);
    assert.deepEqual(f.provider.parameters, { name: "PBKDF2", hash: vector.hash, salt: vector.salt, iterations: vector.iterations, byteLength: vector.length });
    assert.equal(result, f.provider.nativeResult!.buffer);
  });
}

for (const name of names) {
  test(name + " selects every registered SHA hash per derivation, not per imported key", async () => {
    const f = fixture();
    const material = new Uint8Array([0, 1, 2, 255]);
    const key = await f.key(name, material);
    for (const hash of hashes) {
      const algorithm = parameters(name, hash);
      const digest = hash.toLowerCase().replace("-", "");
      const expected = algorithm.name === "HKDF"
        ? new Uint8Array(hkdfSync(digest, material, algorithm.salt, algorithm.info, 42))
        : new Uint8Array(pbkdf2Sync(material, algorithm.salt, algorithm.iterations, 42, digest));
      const result = await f.settle(f.subtle.deriveBits(algorithm, key, 336));
      assert.deepEqual(new Uint8Array(result), expected);
      assert.deepEqual(key.algorithm, { name });
      const native = f.provider.parameters;
      assert.ok(native?.name === name && (native.name === "HKDF" || native.name === "PBKDF2"));
      assert.equal(native.hash, hash);
    }
    assert.equal(f.provider.derives, 4);
    assert.equal(f.provider.digests, 0);
    assert.equal(f.provider.signs, 0);
  });

  test(name + " derives from empty key material and accepts empty salt and info", async () => {
    const f = fixture();
    const empty = new Uint8Array();
    const key = await f.key(name, empty);
    const algorithm = name === "HKDF"
      ? { name, hash: "SHA-256", salt: empty, info: empty }
      : { name, hash: "SHA-256", salt: empty, iterations: 1 };
    const expected = name === "HKDF"
      ? new Uint8Array(hkdfSync("sha256", empty, empty, empty, 32))
      : new Uint8Array(pbkdf2Sync(empty, empty, 1, 32, "sha256"));
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits(algorithm, key, 256))), expected);
    assert.equal(f.provider.derives, 1);
  });

  test(name + " rejects null and non-byte output lengths before native derivation", async () => {
    const f = fixture();
    const key = await f.key(name);
    const algorithm = parameters(name);
    for (const length of [null, undefined, 1, 7, 9, 255, 0xffffffff]) {
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, length)), dom("OperationError"));
    }
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key)), dom("OperationError"));
    assert.equal(f.provider.derives, 0);
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, key, 8))).byteLength, 1);
    assert.equal(f.provider.derives, 1);
  });

  test(name + " enforces the common unsigned output length conversion before derivation", async () => {
    const f = fixture();
    const key = await f.key(name);
    const algorithm = parameters(name);
    for (const length of [-1, -8, NaN, Infinity, -Infinity, 0x100000000, 8n]) {
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, length)), TypeError);
    }
    assert.equal(f.provider.derives, 0);
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, key, 8.9))).byteLength, 1);
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, key, "16"))).byteLength, 2);
    assert.equal(f.provider.derives, 2);
  });

  test(name + " maps both native failure values and rejects inconsistent output width", async () => {
    const f = fixture();
    const key = await f.key(name);
    const algorithm = parameters(name);
    for (const failure of ["invalid-key", "operation"] as const) {
      f.provider.failure = { failure };
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, 128)), dom("OperationError"));
    }
    f.provider.failure = undefined;
    for (const width of [0, 1, 15, 17, 32]) {
      f.provider.result = new Uint8Array(width);
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, 128)), dom("OperationError"));
    }
    f.provider.result = new Uint8Array(16);
    const result = await f.settle(f.subtle.deriveBits(algorithm, key, 128));
    assert.deepEqual(result, new Uint8Array(16).buffer);
    assert.equal(result, f.provider.result.buffer);
    assert.equal(f.provider.derives, 8);
  });

  test(name + " checks the base key algorithm and deriveBits usage before operation policy", async () => {
    const f = fixture();
    const wrongAlgorithm = await f.key(name === "HKDF" ? "PBKDF2" : "HKDF");
    const wrongUsage = await f.key(name, new Uint8Array([1]), ["deriveKey"]);
    const algorithm = parameters(name);
    for (const key of [wrongAlgorithm, wrongUsage]) {
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, null)), dom("InvalidAccessError"));
      await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, 128)), dom("InvalidAccessError"));
    }
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, {}, 128)), TypeError);
    assert.equal(f.provider.derives, 0);
  });

  test(name + " derives using private metadata despite mutations to public snapshots", async () => {
    const f = fixture();
    const key = await f.key(name);
    const algorithm = parameters(name);
    const expected = await f.settle(f.subtle.deriveBits(algorithm, key, 128));
    key.algorithm.name = name === "HKDF" ? "PBKDF2" : "HKDF";
    key.usages.length = 0;
    assert.deepEqual(await f.settle(f.subtle.deriveBits(algorithm, key, 128)), expected);
    assert.equal(f.provider.derives, 2);
  });

  test(name + " transfers exact owned output independent of inputs and other results", async () => {
    const f = fixture();
    const material = new Uint8Array([1, 2, 3]);
    const key = await f.key(name, material);
    const algorithm = parameters(name);
    const first = await f.settle(f.subtle.deriveBits(algorithm, key, 256));
    const second = await f.settle(f.subtle.deriveBits(algorithm, key, 256));
    assert.notEqual(first, second);
    assert.equal(first.byteLength, 32);
    assert.notEqual(first, material.buffer);
    assert.notEqual(first, algorithm.salt.buffer);
    if (algorithm.name === "HKDF") assert.notEqual(first, algorithm.info.buffer);
    new Uint8Array(first).fill(0);
    assert.deepEqual(await f.settle(f.subtle.deriveBits(algorithm, key, 256)), second);
    assert.deepEqual(material, new Uint8Array([1, 2, 3]));
    assert.deepEqual(algorithm.salt, new Uint8Array([4, 5]));
    if (algorithm.name === "HKDF") assert.deepEqual(algorithm.info, new Uint8Array([6, 7]));
  });

  test(name + " consumes borrowed view bounds before return and schedules settlement", async () => {
    const f = fixture();
    const key = await f.key(name);
    const salt = new Uint8Array([91, 4, 5, 92]);
    const info = new Uint8Array([93, 6, 7, 94]);
    const algorithm = name === "HKDF"
      ? { name, hash: "SHA-256", salt: new DataView(salt.buffer, 1, 2), info: new Uint8Array(info.buffer, 1, 2) }
      : { name, hash: "SHA-256", salt: new DataView(salt.buffer, 1, 2), iterations: 2 };
    const expected = await f.settle(f.subtle.deriveBits(parameters(name), key, 128));
    const pending = f.subtle.deriveBits(algorithm, key, 128);
    assert.equal(f.provider.derives, 2);
    const native = f.provider.parameters;
    assert.ok(native?.name === name && (native.name === "HKDF" || native.name === "PBKDF2"));
    assert.equal(native.salt.buffer, salt.buffer);
    assert.equal(native.salt.byteOffset, 1);
    assert.equal(native.salt.byteLength, 2);
    if (native.name === "HKDF") {
      assert.equal(native.info.buffer, info.buffer);
      assert.equal(native.info.byteOffset, 1);
      assert.equal(native.info.byteLength, 2);
    }
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    salt.fill(0);
    info.fill(0);
    assert.deepEqual(await f.settle(pending), expected);
    assert.equal(settled, true);
    f.provider.failure = { failure: "operation" };
    const failed = f.subtle.deriveBits(parameters(name), key, 128);
    assert.equal(f.provider.derives, 3);
    let rejected = false;
    void failed.catch(() => { rejected = true; });
    const rejection = assert.rejects(failed, dom("OperationError"));
    await Promise.resolve();
    assert.equal(rejected, false);
    f.scheduler.runPending();
    await rejection;
    assert.equal(rejected, true);
  });
}

test("HKDF checks 255 times the selected digest output width before native derivation", async () => {
  const f = fixture();
  const key = await f.key("HKDF");
  const widths = [20, 32, 48, 64];
  for (let index = 0; index < hashes.length; index++) {
    const hash = hashes[index]!;
    const limit = widths[index]! * 255;
    const algorithm = parameters("HKDF", hash);
    const before = f.provider.derives;
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, (limit + 1) * 8)), dom("OperationError"));
    assert.equal(f.provider.derives, before);
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, key, limit * 8))).byteLength, limit);
    assert.equal(f.provider.derives, before + 1);
  }
});

test("HKDF zero-length derivation still calls native and checks its result", async () => {
  const f = fixture();
  const key = await f.key("HKDF");
  const algorithm = parameters("HKDF");
  const first = await f.settle(f.subtle.deriveBits(algorithm, key, 0));
  const second = await f.settle(f.subtle.deriveBits(algorithm, key, 0));
  assert.equal(first.byteLength, 0);
  assert.equal(second.byteLength, 0);
  assert.notEqual(first, second);
  assert.equal(f.provider.derives, 2);
  assert.ok(f.provider.parameters?.name === "HKDF");
  assert.equal(f.provider.parameters.byteLength, 0);
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, 0)), dom("OperationError"));
  }
  f.provider.failure = undefined;
  f.provider.result = new Uint8Array(1);
  await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, 0)), dom("OperationError"));
  assert.equal(f.provider.derives, 5);
});

test("PBKDF2 validates iterations before returning fresh zero-length output without native work", async () => {
  const f = fixture();
  const key = await f.key("PBKDF2");
  const algorithm = { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(), iterations: 0 };
  for (const length of [null, 7, 0, 8]) {
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, key, length)), dom("OperationError"));
  }
  assert.equal(f.provider.derives, 0);
  f.provider.failure = { failure: "operation" };
  const outputs: ArrayBuffer[] = [];
  for (const iterations of [1, 2, 0x7fffffff, 0x80000000, 0xffffffff]) {
    algorithm.iterations = iterations;
    const pending = f.subtle.deriveBits(algorithm, key, 0);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    const result = await f.settle(pending);
    assert.equal(result.byteLength, 0);
    for (const previous of outputs) assert.notEqual(result, previous);
    outputs.push(result);
  }
  assert.equal(f.provider.derives, 0);
});

test("PBKDF2 does not impose a fixture-provider bound on valid unsigned iterations", async () => {
  const f = fixture();
  const key = await f.key("PBKDF2");
  f.provider.result = new Uint8Array(1);
  for (const iterations of [1, 2, 0x7fffffff, 0x80000000, 0xffffffff]) {
    await f.settle(f.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(), iterations }, key, 8));
    assert.ok(f.provider.parameters?.name === "PBKDF2");
    assert.equal(f.provider.parameters.iterations, iterations);
  }
  assert.equal(f.provider.derives, 5);
});

test("PBKDF2 has no HKDF expansion-length ceiling", async () => {
  const f = fixture();
  const key = await f.key("PBKDF2");
  const length = 32 * 255 + 1;
  const result = await f.settle(f.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(), iterations: 1 }, key, length * 8));
  assert.equal(result.byteLength, length);
  assert.equal(f.provider.derives, 1);
});

test("HKDF shared policy leaves native info-size support to the provider", async () => {
  const f = fixture();
  const key = await f.key("HKDF");
  const info = new Uint8Array(1025).fill(5);
  f.provider.result = new Uint8Array(1);
  const result = await f.settle(f.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info }, key, 8));
  assert.equal(result.byteLength, 1);
  assert.ok(f.provider.parameters?.name === "HKDF");
  assert.equal(f.provider.parameters.info, info);
  assert.equal(f.provider.derives, 1);
});
