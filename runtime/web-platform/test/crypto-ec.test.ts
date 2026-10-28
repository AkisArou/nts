// Specification controls, not copies of WPT.
// Web Cryptography §§23.7.1–2 and 24.4.2: https://w3c.github.io/webcrypto/
// Independent known answers: RFC 6979 Appendix A.2.5–7 and RFC 5903 §8;
// source and license notices are retained in ec-fixtures.ts.
import assert from "node:assert/strict";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import type { EcAlgorithmName } from "../src/crypto/algorithms.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import { createCryptoKey, getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoDerivationParameters,
  CryptoDigestName,
  CryptoFailure,
  CryptoKeyHandle,
  CryptoNamedCurve,
  CryptoSignature,
  CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import {
  ecOrder, ecPrivateJwk, ecPublicJwk, ecSpki,
  ecdhPrivateJwk, ecdhPublicJwk, ecdhSecret, ecdsaMessage, ecdsaSignature,
} from "./ec-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  signs = 0;
  verifies = 0;
  derives = 0;
  digests = 0;
  signed: Uint8Array | undefined;
  verified: Uint8Array | undefined;
  signature: CryptoSignature | undefined;
  signatureParameters: CryptoSignatureParameters | undefined;
  agreementParameters: CryptoDerivationParameters | undefined;
  agreementKey: CryptoKeyHandle | undefined;
  failure: CryptoFailure | undefined;
  returnedSignature: CryptoSignature | undefined;
  returnedSecret: Uint8Array | undefined;

  override digest(name: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.digests++;
    return super.digest(name, bytes);
  }

  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.signed = bytes;
    this.signatureParameters = parameters;
    return this.failure ?? this.returnedSignature ?? super.sign(parameters, key, bytes);
  }

  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, signature: CryptoSignature, bytes: Uint8Array): boolean {
    this.verifies++;
    this.verified = bytes;
    this.signature = signature;
    this.signatureParameters = parameters;
    return super.verify(parameters, key, signature, bytes);
  }

  override derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    this.agreementParameters = parameters;
    this.agreementKey = key;
    return this.failure ?? this.returnedSecret ?? super.derive(parameters, key);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const random = { fill(bytes: Uint8Array): void { bytes.fill(0x42); } };
  const subtle = new Crypto(random, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: EcAlgorithmName, curve: CryptoNamedCurve, type: "public" | "private", usages?: readonly KeyUsage[]): Promise<CryptoKey> {
    const use: readonly KeyUsage[] = usages ?? (name === "ECDH"
      ? type === "public" ? [] : ["deriveBits"]
      : type === "public" ? ["verify"] : ["sign"]);
    return settle(subtle.importKey("jwk", type === "public" ? ecPublicJwk(curve) : ecPrivateJwk(curve), { name, namedCurve: curve }, true, use));
  }
  async function agreement(curve: CryptoNamedCurve) {
    const algorithm = { name: "ECDH", namedCurve: curve };
    const privateKey = await settle(subtle.importKey("jwk", ecdhPrivateJwk(curve, "initiator"), algorithm, false, ["deriveBits"]));
    const publicKey = await settle(subtle.importKey("jwk", ecdhPublicJwk(curve, "responder"), algorithm, false, []));
    return { privateKey, publicKey };
  }
  return { provider, scheduler, subtle, settle, key, agreement };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

const curves: readonly { name: CryptoNamedCurve; width: number }[] = [
  { name: "P-256", width: 32 }, { name: "P-384", width: 48 }, { name: "P-521", width: 66 },
];
const hashes: readonly CryptoDigestName[] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];

for (const curve of curves) {
  for (const hash of hashes) {
    test("ECDSA " + curve.name + " " + hash + " verifies RFC 6979's independent fixed-width answer", async () => {
      const f = fixture();
      const publicKey = await f.key("ECDSA", curve.name, "public");
      const signature = ecdsaSignature(curve.name, hash);
      const bytes = ecdsaMessage();
      assert.equal(signature.byteLength, curve.width * 2);
      assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash }, publicKey, signature, bytes)), true);
      assert.equal(f.provider.verifies, 1);
      assert.equal(f.provider.digests, 0, "the whole signature operation crosses one native boundary");
      assert.equal(f.provider.verified, bytes);
      assert.deepEqual(f.provider.signatureParameters, { name: "ECDSA", hash });
      assert.equal(f.provider.signature!.kind, "ecdsa");
      if (f.provider.signature!.kind !== "ecdsa") assert.fail("wrong native signature kind");
      assert.equal(f.provider.signature!.r.buffer, signature.buffer);
      assert.equal(f.provider.signature!.s.buffer, signature.buffer);
      assert.equal(f.provider.signature!.r.byteLength, curve.width);
      assert.equal(f.provider.signature!.s.byteOffset, signature.byteOffset + curve.width);
      const damaged = signature.slice(); damaged[curve.width - 1]! ^= 1;
      assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash }, publicKey, damaged, bytes)), false);
      assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash }, publicKey, signature, new Uint8Array())), false);
      const otherHash = hash === "SHA-256" ? "SHA-384" : "SHA-256";
      assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash: otherHash }, publicKey, signature, bytes)), false);
    });
  }

  test("ECDSA " + curve.name + " signs with each requested hash into fresh P1363 output", async () => {
    const f = fixture();
    const privateKey = await f.key("ECDSA", curve.name, "private");
    const publicKey = await f.key("ECDSA", curve.name, "public");
    const nativePublic = createPublicKey({ key: Buffer.from(ecSpki(curve.name)), format: "der", type: "spki" });
    for (const hash of hashes) {
      for (const bytes of [ecdsaMessage(), new Uint8Array()]) {
        const signature = await f.settle(f.subtle.sign({ name: "ECDSA", hash }, privateKey, bytes));
        assert.equal(signature.byteLength, curve.width * 2);
        assert.equal(f.provider.signed, bytes);
        assert.deepEqual(f.provider.signatureParameters, { name: "ECDSA", hash });
        assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash }, publicKey, signature, bytes)), true);
        assert.equal(verifySignature(hash.toLowerCase().replace("-", ""), bytes, { key: nativePublic, dsaEncoding: "ieee-p1363" }, new Uint8Array(signature)), true);
        const next = await f.settle(f.subtle.sign({ name: "ECDSA", hash }, privateKey, bytes));
        assert.notEqual(signature, next);
        new Uint8Array(signature).fill(0);
        assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash }, publicKey, next, bytes)), true);
      }
    }
    assert.equal(f.provider.digests, 0);
  });

  test("ECDSA " + curve.name + " rejects noncanonical signature widths before native verification", async () => {
    const f = fixture();
    const publicKey = await f.key("ECDSA", curve.name, "public");
    const algorithm = { name: "ECDSA", hash: "SHA-256" };
    const signature = ecdsaSignature(curve.name);
    for (const invalid of [new Uint8Array(), signature.subarray(1), signature.subarray(0, signature.length - 1), new Uint8Array(signature.length + 1)]) {
      assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, invalid, ecdsaMessage())), false);
    }
    assert.equal(f.provider.verifies, 0);
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, signature, ecdsaMessage())), true);
    assert.equal(f.provider.verifies, 1);
  });

  test("ECDSA " + curve.name + " leaves zero and out-of-range signature integers to native verification", async () => {
    const f = fixture();
    const publicKey = await f.key("ECDSA", curve.name, "public");
    const algorithm = { name: "ECDSA", hash: "SHA-256" };
    const valid = ecdsaSignature(curve.name);
    const zeroR = valid.slice(); zeroR.fill(0, 0, curve.width);
    const zeroS = valid.slice(); zeroS.fill(0, curve.width);
    const orderR = valid.slice(); orderR.set(ecOrder(curve.name));
    const orderS = valid.slice(); orderS.set(ecOrder(curve.name), curve.width);
    for (const invalid of [zeroR, zeroS, orderR, orderS]) {
      assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, invalid, ecdsaMessage())), false);
    }
    assert.equal(f.provider.verifies, 4);
  });

  test("ECDH " + curve.name + " derives RFC 5903's full-width shared secret in both directions", async () => {
    const f = fixture();
    for (const [local, peer] of [["initiator", "responder"], ["responder", "initiator"]] as const) {
      const algorithm = { name: "ECDH", namedCurve: curve.name };
      const privateKey = await f.settle(f.subtle.importKey("jwk", ecdhPrivateJwk(curve.name, local), algorithm, false, ["deriveBits"]));
      const publicKey = await f.settle(f.subtle.importKey("jwk", ecdhPublicJwk(curve.name, peer), algorithm, false, []));
      const result = await f.settle(f.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, null));
      assert.equal(result.byteLength, curve.width);
      assert.deepEqual(new Uint8Array(result), ecdhSecret(curve.name));
      assert.equal(f.provider.agreementKey, getCryptoKeySlots(privateKey).handle);
      assert.deepEqual(f.provider.agreementParameters, { name: "ECDH", publicKey: getCryptoKeySlots(publicKey).handle });
    }
    assert.equal(f.provider.derives, 2);
    assert.equal(f.provider.digests, 0);
  });

  test("ECDH " + curve.name + " truncates leading bits with exact output ownership", async () => {
    const f = fixture();
    const { privateKey, publicKey } = await f.agreement(curve.name);
    const algorithm = { name: "ECDH", public: publicKey };
    const full = ecdhSecret(curve.name);
    for (const bits of [0, 1, 7, 8, 9, 13, curve.width * 8 - 1, curve.width * 8]) {
      const result = await f.settle(f.subtle.deriveBits(algorithm, privateKey, bits));
      const expected = full.slice(0, Math.ceil(bits / 8));
      if (bits % 8 !== 0) expected[expected.length - 1]! &= 0xff << (8 - bits % 8);
      assert.equal(result.byteLength, Math.ceil(bits / 8));
      assert.deepEqual(new Uint8Array(result), expected);
    }
    assert.equal(f.provider.derives, 8, "even zero requested bits validate and perform ECDH");
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, curve.width * 8 + 1)), dom("OperationError"));
    assert.equal(f.provider.derives, 8, "the maximum output bound precedes native execution");
    const first = await f.settle(f.subtle.deriveBits(algorithm, privateKey));
    const second = await f.settle(f.subtle.deriveBits(algorithm, privateKey));
    assert.notEqual(first, second);
    new Uint8Array(first).fill(0);
    assert.deepEqual(new Uint8Array(second), full);
  });
}

test("ECDSA left-pads minimal native r and s without aliasing either component", async () => {
  const f = fixture();
  const key = await f.key("ECDSA", "P-521", "private");
  const r = new Uint8Array([1, 2]);
  const s = new Uint8Array([3]);
  f.provider.returnedSignature = { kind: "ecdsa", r, s };
  const result = new Uint8Array(await f.settle(f.subtle.sign({ name: "ECDSA", hash: "SHA-512" }, key, new Uint8Array())));
  assert.equal(result.length, 132);
  assert.deepEqual([...result.subarray(0, 64)], Array<number>(64).fill(0));
  assert.deepEqual([...result.subarray(64, 66)], [1, 2]);
  assert.deepEqual([...result.subarray(66, 131)], Array<number>(65).fill(0));
  assert.equal(result[131], 3);
  r.fill(9); s.fill(9);
  assert.equal(result[64], 1);
  assert.equal(result[131], 3);
  assert.equal(result.byteOffset, 0);
  assert.equal(result.buffer.byteLength, result.byteLength);
});

test("ECDSA native failure values and invalid result shapes become OperationError", async () => {
  const f = fixture();
  const key = await f.key("ECDSA", "P-256", "private");
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new Uint8Array())), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const result of [
    { kind: "bytes", bytes: new Uint8Array(64) },
    { kind: "ecdsa", r: new Uint8Array(), s: new Uint8Array([1]) },
    { kind: "ecdsa", r: new Uint8Array([1]), s: new Uint8Array() },
    { kind: "ecdsa", r: new Uint8Array(33), s: new Uint8Array([1]) },
    { kind: "ecdsa", r: new Uint8Array([1]), s: new Uint8Array(33) },
  ] as const) {
    f.provider.returnedSignature = result;
    await assert.rejects(f.settle(f.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new Uint8Array())), dom("OperationError"));
  }
});

test("ECDSA key kind, name and private-slot usages precede native operations", async () => {
  const f = fixture();
  const signer = await f.key("ECDSA", "P-256", "private");
  const verifier = await f.key("ECDSA", "P-256", "public");
  const privateSlots = getCryptoKeySlots(signer);
  const publicSlots = getCryptoKeySlots(verifier);
  const wrongSigner = createCryptoKey("public", true, publicSlots.algorithm, ["sign"], publicSlots.handle);
  const wrongVerifier = createCryptoKey("private", true, privateSlots.algorithm, ["verify"], privateSlots.handle);
  const algorithm = { name: "ECDSA", hash: "SHA-256" };
  await assert.rejects(f.settle(f.subtle.sign(algorithm, wrongSigner, new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify(algorithm, wrongVerifier, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.sign(algorithm, verifier, new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify(algorithm, signer, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
  const ecdh = await f.key("ECDH", "P-256", "private");
  await assert.rejects(f.settle(f.subtle.sign(algorithm, ecdh, new Uint8Array())), dom("InvalidAccessError"));
  assert.equal(f.provider.signs, 0);
  assert.equal(f.provider.verifies, 0);
  (signer.algorithm as { name: string; namedCurve: string }).namedCurve = "P-521";
  signer.algorithm.name = "ECDH";
  signer.usages.push("deriveBits");
  const result = await f.settle(f.subtle.sign(algorithm, signer, ecdsaMessage()));
  assert.equal(result.byteLength, 64);
  assert.equal(await f.settle(f.subtle.verify(algorithm, verifier, result, ecdsaMessage())), true);
});

test("ECDSA native calls finish before one queued settlement and borrow input bytes", async () => {
  const f = fixture();
  const signer = await f.key("ECDSA", "P-256", "private");
  const verifier = await f.key("ECDSA", "P-256", "public");
  const bytes = ecdsaMessage();
  const original = bytes.slice();
  const pending = f.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, bytes);
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.signed, bytes);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  bytes.fill(0);
  const signature = await f.settle(pending);
  assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, signature, original)), true);
  assert.equal(await f.settle(f.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, signature, bytes)), false);
});

test("ECDSA borrows only input view bounds and treats a detached message as empty", async () => {
  const f = fixture();
  const signer = await f.key("ECDSA", "P-384", "private");
  const verifier = await f.key("ECDSA", "P-384", "public");
  const bytes = ecdsaMessage();
  const storage = new Uint8Array(bytes.length + 4); storage.set(bytes, 2);
  const messageView = new DataView(storage.buffer, 2, bytes.length);
  const algorithm = { name: "ECDSA", hash: "SHA-384" };
  const signature = new Uint8Array(await f.settle(f.subtle.sign(algorithm, signer, messageView)));
  assert.equal(f.provider.signed!.buffer, storage.buffer);
  assert.equal(f.provider.signed!.byteOffset, 2);
  const signatureStorage = new Uint8Array(signature.length + 4); signatureStorage.set(signature, 1);
  assert.equal(await f.settle(f.subtle.verify(algorithm, verifier, new DataView(signatureStorage.buffer, 1, signature.length), bytes)), true);
  const detached = new ArrayBuffer(3);
  structuredClone(detached, { transfer: [detached] });
  const emptySignature = await f.settle(f.subtle.sign(algorithm, signer, detached));
  assert.equal(await f.settle(f.subtle.verify(algorithm, verifier, emptySignature, new Uint8Array())), true);
});

test("ECDH peer type and algorithm errors precede the output bound and base kind", async () => {
  const f = fixture();
  const base = await f.key("ECDH", "P-256", "private");
  const privatePeer = await f.key("ECDH", "P-256", "private");
  const wrongAlgorithm = await f.key("ECDSA", "P-256", "public");
  for (const publicKey of [privatePeer, wrongAlgorithm]) {
    await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: publicKey }, base, 4_294_967_295)), dom("InvalidAccessError"));
  }
  assert.equal(f.provider.derives, 0);
});

test("ECDH output bound uses the peer curve before base type and curve mismatch checks", async () => {
  const f = fixture();
  const base = await f.key("ECDH", "P-256", "private");
  const peer = await f.key("ECDH", "P-384", "public");
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer }, base, 385)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer }, base, 384)), dom("InvalidAccessError"));
  const publicSlots = getCryptoKeySlots(peer);
  const publicBase = createCryptoKey("public", true, publicSlots.algorithm, ["deriveBits"], publicSlots.handle);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer }, publicBase, 385)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer }, publicBase, 384)), dom("InvalidAccessError"));
  const peer521 = await f.key("ECDH", "P-521", "public");
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer521 }, base, 529)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "ECDH", public: peer521 }, base, 528)), dom("InvalidAccessError"));
  assert.equal(f.provider.derives, 0);
});

test("ECDH rejects native failure values and inconsistent full-width secrets", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement("P-256");
  const algorithm = { name: "ECDH", public: publicKey };
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, null)), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const width of [0, 31, 33]) {
    f.provider.returnedSecret = new Uint8Array(width);
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, 0)), dom("OperationError"));
  }
});

test("ECDH ignores mutable public snapshots and needs no usage on the peer key", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement("P-521");
  (privateKey.algorithm as { name: string; namedCurve: string }).namedCurve = "P-256";
  (publicKey.algorithm as { name: string; namedCurve: string }).namedCurve = "P-384";
  privateKey.algorithm.name = "ECDSA";
  publicKey.algorithm.name = "ECDSA";
  privateKey.usages.length = 0;
  publicKey.usages.push("verify");
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 528))), ecdhSecret("P-521"));
});

test("ECDH runs synchronously and settles success and failure through crypto tasks", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement("P-256");
  const algorithm = { name: "ECDH", public: publicKey };
  const pending = f.subtle.deriveBits(algorithm, privateKey, 128);
  assert.equal(f.provider.derives, 1);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(new Uint8Array(await f.settle(pending)), ecdhSecret("P-256").subarray(0, 16));
  f.provider.failure = { failure: "operation" };
  const failure = f.subtle.deriveBits(algorithm, privateKey, 128);
  const rejection = assert.rejects(failure, dom("OperationError"));
  assert.equal(f.provider.derives, 2);
  f.scheduler.runPending();
  await rejection;
});
