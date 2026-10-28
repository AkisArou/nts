// Web Cryptography §§25.3.1–2 and 26.3.1: https://w3c.github.io/webcrypto/
// Specification controls, with independent RFC 8032 §7.1 and RFC 7748 §§5.2,
// 6.1 answers from okp-fixtures.ts. No Node WebCrypto is used.
import assert from "node:assert/strict";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { createCryptoKey, getCryptoKeySlots, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoDerivationParameters, CryptoDigestName, CryptoFailure, CryptoKeyHandle,
  CryptoSignature, CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import {
  ed25519Message, ed25519PrivateJwk, ed25519PublicJwk, ed25519Signature,
  okpPrivateJwk, okpPublicJwk, okpSpki, x25519PrivateJwk, x25519PublicJwk, x25519Secret,
} from "./okp-fixtures.ts";

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
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { bytes.fill(0x37); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: "Ed25519" | "X25519", type: "public" | "private", usages?: readonly KeyUsage[]): Promise<CryptoKey> {
    const use: readonly KeyUsage[] = usages ?? (name === "X25519"
      ? type === "public" ? [] : ["deriveBits"] : type === "public" ? ["verify"] : ["sign"]);
    return settle(subtle.importKey("jwk", type === "public" ? okpPublicJwk(name) : okpPrivateJwk(name), name, true, use));
  }
  async function agreement() {
    const privateKey = await settle(subtle.importKey("jwk", x25519PrivateJwk("alice"), "X25519", false, ["deriveBits"]));
    const publicKey = await settle(subtle.importKey("jwk", x25519PublicJwk("bob"), "X25519", false, []));
    return { privateKey, publicKey };
  }
  return { provider, scheduler, subtle, settle, key, agreement };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function hex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

for (const index of [0, 1, 2, 3, 4]) {
  test(`Ed25519 signs and verifies RFC 8032 §7.1 answer ${index + 1}`, async () => {
    const f = fixture();
    const privateKey = await f.settle(f.subtle.importKey("jwk", ed25519PrivateJwk(index), "Ed25519", false, ["sign"]));
    const publicKey = await f.settle(f.subtle.importKey("jwk", ed25519PublicJwk(index), "Ed25519", false, ["verify"]));
    const message = ed25519Message(index);
    const expected = ed25519Signature(index);
    const algorithm = { name: "eD25519", get hash() { throw new Error("Ed25519 has no external hash parameter"); } };
    const actual = await f.settle(f.subtle.sign(algorithm, privateKey, message));
    assert.equal(actual.byteLength, 64);
    assert.deepEqual(new Uint8Array(actual), expected);
    assert.equal(f.provider.signed, message);
    assert.deepEqual(f.provider.signatureParameters, { name: "Ed25519" });
    assert.equal(f.provider.signs, 1);
    assert.equal(f.provider.digests, 0, "the hash and signature form one native operation");
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, expected, message)), true);
    assert.equal(f.provider.verified, message);
    assert.equal(f.provider.signature?.kind, "bytes");
    if (f.provider.signature?.kind !== "bytes") assert.fail("unexpected signature kind");
    assert.equal(f.provider.signature.bytes, expected);
    const damaged = expected.slice(); damaged[index]! ^= 1;
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, damaged, message)), false);
    const otherMessage = new Uint8Array(message.length + 1); otherMessage.set(message); otherMessage[message.length] = 1;
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, expected, otherMessage)), false);
  });
}

test("Ed25519 signatures own exact buffers and verify independently with native primitives", async () => {
  const f = fixture();
  const key = await f.key("Ed25519", "private");
  const message = new Uint8Array([1, 2, 3, 4, 5]);
  const first = await f.settle(f.subtle.sign("Ed25519", key, message));
  const second = await f.settle(f.subtle.sign("Ed25519", key, message));
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  new Uint8Array(first).fill(0);
  const native = createPublicKey({ key: Buffer.from(okpSpki("Ed25519")), format: "der", type: "spki" });
  assert.equal(verifySignature(null, message, native, new Uint8Array(second)), true);
  assert.equal(second.byteLength, 64);
});

test("Ed25519 rejects every incorrect signature width before native verification", async () => {
  const f = fixture();
  const key = await f.key("Ed25519", "public");
  const signature = ed25519Signature();
  for (const bytes of [new Uint8Array(), signature.subarray(1), signature.subarray(0, 32), new Uint8Array(65), new Uint8Array(128)]) {
    const pending = f.subtle.verify("Ed25519", key, bytes, ed25519Message());
    assert.equal(f.scheduler.hasPending, true);
    assert.equal(await f.settle(pending), false);
  }
  assert.equal(f.provider.verifies, 0);
  assert.equal(await f.settle(f.subtle.verify("Ed25519", key, signature, ed25519Message())), true);
});

test("Ed25519 rejects noncanonical and out-of-range S without reducing the scalar", async () => {
  const f = fixture();
  const key = await f.key("Ed25519", "public");
  const signature = ed25519Signature();
  const order = hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010");
  for (const scalar of [new Uint8Array(32), order, new Uint8Array(32).fill(0xff)]) {
    const invalid = signature.slice(); invalid.set(scalar, 32);
    assert.equal(await f.settle(f.subtle.verify("Ed25519", key, invalid, ed25519Message())), false);
  }
  const highBit = signature.slice(); highBit[63]! |= 0x80;
  assert.equal(await f.settle(f.subtle.verify("Ed25519", key, highBit, ed25519Message())), false);
  assert.equal(f.provider.verifies, 4);
});

const invalidEdPoints = [
  { name: "identity", bytes: hex("0100000000000000000000000000000000000000000000000000000000000000") },
  { name: "order two", bytes: hex("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f") },
  { name: "order four", bytes: new Uint8Array(32) },
  { name: "noncanonical field modulus", bytes: hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f") },
  { name: "noncanonical identity", bytes: hex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f") },
  { name: "out-of-range encoding", bytes: new Uint8Array(32).fill(0xff) },
];

for (const point of invalidEdPoints) {
  test(`Ed25519 imports ${point.name} bytes but rejects them during verification`, async () => {
    const f = fixture();
    const key = await f.settle(f.subtle.importKey("raw", point.bytes, "Ed25519", true, ["verify"]));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), point.bytes.buffer);
    const forged = new Uint8Array(64); forged[0] = 1; // R = identity, S = 0.
    assert.equal(await f.settle(f.subtle.verify("Ed25519", key, forged, new Uint8Array())), false);
    assert.equal(await f.settle(f.subtle.verify("Ed25519", key, ed25519Signature(), ed25519Message())), false);
    const valid = await f.key("Ed25519", "public");
    const signature = ed25519Signature(); signature.set(point.bytes);
    assert.equal(await f.settle(f.subtle.verify("Ed25519", valid, signature, ed25519Message())), false);
  });
}

test("Ed25519 native failure values and invalid output shapes become queued OperationError", async () => {
  const f = fixture();
  const key = await f.key("Ed25519", "private");
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    const pending = f.subtle.sign("Ed25519", key, new Uint8Array());
    assert.equal(f.scheduler.hasPending, true);
    await assert.rejects(f.settle(pending), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const result of [
    { kind: "ecdsa", r: new Uint8Array(32), s: new Uint8Array(32) },
    { kind: "bytes", bytes: new Uint8Array() },
    { kind: "bytes", bytes: new Uint8Array(63) },
    { kind: "bytes", bytes: new Uint8Array(65) },
  ] as const) {
    f.provider.returnedSignature = result;
    await assert.rejects(f.settle(f.subtle.sign("Ed25519", key, new Uint8Array())), dom("OperationError"));
  }
});

test("Ed25519 key kind, algorithm and private-slot permissions precede native operations", async () => {
  const f = fixture();
  const signer = await f.key("Ed25519", "private");
  const verifier = await f.key("Ed25519", "public");
  const privateSlots = getCryptoKeySlots(signer);
  const publicSlots = getCryptoKeySlots(verifier);
  const publicSigner = createCryptoKey("public", true, publicSlots.algorithm, ["sign"], publicSlots.handle);
  const privateVerifier = createCryptoKey("private", true, privateSlots.algorithm, ["verify"], privateSlots.handle);
  await assert.rejects(f.settle(f.subtle.sign("Ed25519", publicSigner, new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify("Ed25519", privateVerifier, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.sign("Ed25519", verifier, new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify("Ed25519", signer, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
  const agreement = await f.key("X25519", "private");
  await assert.rejects(f.settle(f.subtle.sign("Ed25519", agreement, new Uint8Array())), dom("InvalidAccessError"));
  assert.equal(f.provider.signs, 0);
  assert.equal(f.provider.verifies, 0);
  signer.algorithm.name = "X25519"; signer.usages.length = 0;
  verifier.algorithm.name = "X25519"; verifier.usages.push("deriveBits");
  const signature = await f.settle(f.subtle.sign("Ed25519", signer, ed25519Message()));
  assert.equal(await f.settle(f.subtle.verify("Ed25519", verifier, signature, ed25519Message())), true);
});

test("Ed25519 borrows input view bounds and treats detached messages as empty", async () => {
  const f = fixture();
  const signer = await f.key("Ed25519", "private");
  const verifier = await f.key("Ed25519", "public");
  const bytes = new Uint8Array([1, 2, 3]);
  const storage = new Uint8Array([9, 1, 2, 3, 8]);
  const signature = new Uint8Array(await f.settle(f.subtle.sign("Ed25519", signer, new DataView(storage.buffer, 1, 3))));
  assert.equal(f.provider.signed!.buffer, storage.buffer);
  assert.equal(f.provider.signed!.byteOffset, 1);
  assert.equal(f.provider.signed!.byteLength, 3);
  const signatureStorage = new Uint8Array(67); signatureStorage.set(signature, 2);
  assert.equal(await f.settle(f.subtle.verify("Ed25519", verifier, new DataView(signatureStorage.buffer, 2, 64), bytes)), true);
  const detached = new ArrayBuffer(3);
  structuredClone(detached, { transfer: [detached] });
  const empty = await f.settle(f.subtle.sign("Ed25519", signer, detached));
  assert.deepEqual(new Uint8Array(empty), ed25519Signature());
  assert.equal(await f.settle(f.subtle.verify("Ed25519", verifier, detached, new Uint8Array())), false);
});

test("Ed25519 executes before returning and settles sign and verify through crypto tasks", async () => {
  const f = fixture();
  const signer = await f.key("Ed25519", "private");
  const verifier = await f.key("Ed25519", "public");
  const bytes = new Uint8Array([5, 8, 13]);
  const original = bytes.slice();
  const pending = f.subtle.sign("Ed25519", signer, bytes);
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.signed, bytes);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  bytes.fill(0);
  const signature = await f.settle(pending);
  const verified = f.subtle.verify("Ed25519", verifier, signature, original);
  assert.equal(f.provider.verifies, 1);
  assert.equal(f.scheduler.hasPending, true);
  assert.equal(await f.settle(verified), true);
  assert.equal(await f.settle(f.subtle.verify("Ed25519", verifier, signature, bytes)), false);
});

test("X25519 derives the RFC 7748 shared secret in both directions", async () => {
  const f = fixture();
  for (const [local, peer] of [["alice", "bob"], ["bob", "alice"]] as const) {
    const privateKey = await f.settle(f.subtle.importKey("jwk", x25519PrivateJwk(local), "X25519", false, ["deriveBits"]));
    const publicKey = await f.settle(f.subtle.importKey("jwk", x25519PublicJwk(peer), "X25519", false, []));
    const result = await f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey));
    assert.deepEqual(new Uint8Array(result), x25519Secret());
    assert.equal(result.byteLength, 32);
    assert.equal(f.provider.agreementKey, getCryptoKeySlots(privateKey).handle);
    assert.deepEqual(f.provider.agreementParameters, { name: "X25519", publicKey: getCryptoKeySlots(publicKey).handle });
  }
  assert.equal(f.provider.derives, 2);
  assert.equal(f.provider.digests, 0);
});

test("X25519 truncates leading bits into independently owned exact buffers", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X25519", public: publicKey };
  const full = x25519Secret();
  for (const bits of [0, 1, 7, 8, 9, 13, 255, 256]) {
    const result = await f.settle(f.subtle.deriveBits(algorithm, privateKey, bits));
    const expected = full.slice(0, Math.ceil(bits / 8));
    if (bits % 8 !== 0) expected[expected.length - 1]! &= 0xff << (8 - bits % 8);
    assert.deepEqual(new Uint8Array(result), expected);
    assert.equal(result.byteLength, Math.ceil(bits / 8));
  }
  assert.equal(f.provider.derives, 8, "zero requested bits still perform agreement");
  const first = await f.settle(f.subtle.deriveBits(algorithm, privateKey));
  const second = await f.settle(f.subtle.deriveBits(algorithm, privateKey));
  assert.notEqual(first, second);
  new Uint8Array(first).fill(0);
  assert.deepEqual(new Uint8Array(second), full);
});

test("X25519 masks the input top bit and accepts noncanonical field encodings as RFC 7748 requires", async () => {
  const f = fixture();
  const { privateKey } = await f.agreement();
  const bob = new Uint8Array(Buffer.from(x25519PublicJwk("bob").x, "base64url"));
  bob[31]! ^= 0x80;
  const masked = await f.settle(f.subtle.importKey("raw", bob, "X25519", true, []));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", masked)), bob.buffer);
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X25519", public: masked }, privateKey))), x25519Secret());
  const basePoint = new Uint8Array(32); basePoint[0] = 9;
  const noncanonical = hex("f6ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"); // p + 9.
  const expected = new Uint8Array(Buffer.from(x25519PublicJwk("alice").x, "base64url"));
  for (const bytes of [basePoint, noncanonical]) {
    const publicKey = await f.settle(f.subtle.importKey("raw", bytes, "X25519", true, []));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", publicKey)), bytes.buffer);
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey))), expected);
  }
});

test("X25519 imports low-order peers but rejects their all-zero agreement even for zero requested bits", async () => {
  const f = fixture();
  const { privateKey } = await f.agreement();
  for (const bytes of [
    new Uint8Array(32), hex("0100000000000000000000000000000000000000000000000000000000000000"),
    hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
    hex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
  ]) {
    const publicKey = await f.settle(f.subtle.importKey("raw", bytes, "X25519", true, []));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", publicKey)), bytes.buffer);
    for (const length of [null, 0, 1, 256]) {
      await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, length)), dom("OperationError"));
    }
  }
  assert.equal(f.provider.derives, 16);
});

test("X25519 checks all native secret bytes before truncation and before returning zero bits", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X25519", public: publicKey };
  f.provider.returnedSecret = new Uint8Array(32);
  for (const length of [null, 0, 1, 8, 256]) {
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, length)), dom("OperationError"));
  }
  for (let index = 0; index < 32; index++) {
    const secret = new Uint8Array(32); secret[index] = 1;
    f.provider.returnedSecret = secret;
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, privateKey, 0))).byteLength, 0);
  }
  f.provider.returnedSecret = new Uint8Array(32); f.provider.returnedSecret[31] = 1;
  assert.deepEqual(await f.settle(f.subtle.deriveBits(algorithm, privateKey, 8)), new Uint8Array([0]).buffer);
});

test("X25519 peer type and algorithm precede the output bound and base kind", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const wrongAlgorithm = await f.key("Ed25519", "public");
  for (const peer of [privateKey, wrongAlgorithm]) {
    await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: peer }, privateKey, 0xffffffff)), dom("InvalidAccessError"));
  }
  const publicSlots = getCryptoKeySlots(publicKey);
  const publicBase = createCryptoKey("public", true, publicSlots.algorithm, ["deriveBits"], publicSlots.handle);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, publicBase, 257)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, publicBase, 256)), dom("InvalidAccessError"));
  const privateSlots = getCryptoKeySlots(privateKey);
  const mismatched = createCryptoKey("private", false, new KeyAlgorithm("ECDH"), ["deriveBits"], privateSlots.handle);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, mismatched, 257)), dom("InvalidAccessError"));
  assert.equal(f.provider.derives, 0);
});

test("X25519 rejects native failure values and inconsistent full-width secrets", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X25519", public: publicKey };
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, null)), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const length of [0, 31, 33]) {
    f.provider.returnedSecret = new Uint8Array(length).fill(1);
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, 0)), dom("OperationError"));
  }
});

test("X25519 uses private metadata snapshots and needs no peer usage", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  privateKey.algorithm.name = "Ed25519"; privateKey.usages.length = 0;
  publicKey.algorithm.name = "Ed25519"; publicKey.usages.push("verify");
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey))), x25519Secret());
});

test("X25519 completes synchronously and settles success and failure through crypto tasks", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X25519", public: publicKey };
  const pending = f.subtle.deriveBits(algorithm, privateKey, 128);
  assert.equal(f.provider.derives, 1);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(new Uint8Array(await f.settle(pending)), x25519Secret().subarray(0, 16));
  f.provider.failure = { failure: "operation" };
  const failure = f.subtle.deriveBits(algorithm, privateKey, 128);
  const rejected = assert.rejects(failure, dom("OperationError"));
  assert.equal(f.provider.derives, 2);
  f.scheduler.runPending();
  await rejected;
});
