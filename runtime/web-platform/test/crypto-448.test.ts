// Secure Curves §§4.3 and 6.4: https://wicg.github.io/webcrypto-secure-curves/
// Independent RFC 8032 §7.4 and RFC 7748 §§5.2, 6.2 answers come from
// curve448-fixtures.ts. Native primitives are used without Node WebCrypto.
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
import {
  curve448PrivateJwk, curve448PublicJwk, curve448Spki,
  ed448Context, ed448Message, ed448PrivateJwk, ed448PublicJwk, ed448Signature,
  x448PrivateJwk, x448PublicJwk, x448ScalarVector, x448Secret,
} from "./curve448-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { ed25519PublicJwk, x25519PublicJwk } from "./okp-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  signs = 0;
  verifies = 0;
  derives = 0;
  digests = 0;
  signed: Uint8Array | undefined;
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

  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, signature: CryptoSignature, bytes: Uint8Array): boolean | CryptoFailure {
    this.verifies++;
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
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { bytes.fill(7); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: "Ed448" | "X448", type: "public" | "private", usages?: readonly KeyUsage[]): Promise<CryptoKey> {
    const use: readonly KeyUsage[] = usages ?? (name === "X448"
      ? type === "public" ? [] : ["deriveBits"] : type === "public" ? ["verify"] : ["sign"]);
    return settle(subtle.importKey("jwk", type === "public" ? curve448PublicJwk(name) : curve448PrivateJwk(name), name, true, use));
  }
  async function agreement() {
    const privateKey = await settle(subtle.importKey("jwk", x448PrivateJwk("alice"), "X448", false, ["deriveBits"]));
    const publicKey = await settle(subtle.importKey("jwk", x448PublicJwk("bob"), "X448", false, []));
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

for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`Ed448 signs and verifies RFC 8032 §7.4 answer ${index + 1}`, async () => {
    const f = fixture();
    const privateKey = await f.settle(f.subtle.importKey("jwk", ed448PrivateJwk(index), "Ed448", false, ["sign"]));
    const publicKey = await f.settle(f.subtle.importKey("jwk", ed448PublicJwk(index), "Ed448", false, ["verify"]));
    const message = ed448Message(index);
    const context = ed448Context(index);
    const expected = ed448Signature(index);
    const algorithm = {
      name: "eD448", context,
      get hash() { throw new Error("Ed448 hashing stays inside the primitive"); },
    };
    const actual = await f.settle(f.subtle.sign(algorithm, privateKey, message));
    assert.equal(actual.byteLength, 114);
    assert.deepEqual(new Uint8Array(actual), expected);
    assert.equal(f.provider.signed, message);
    assert.deepEqual(f.provider.signatureParameters, { name: "Ed448", context });
    assert.equal(f.provider.signs, 1);
    assert.equal(f.provider.digests, 0);
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, expected, message)), true);
    assert.ok(f.provider.signature?.kind === "bytes");
    assert.equal(f.provider.signature.bytes, expected);
    const damaged = expected.slice(); damaged[index]! ^= 1;
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, damaged, message)), false);
    const otherMessage = new Uint8Array(message.length + 1); otherMessage.set(message); otherMessage[message.length] = 1;
    assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, expected, otherMessage)), false);
    const otherContext = new Uint8Array(context.length + 1); otherContext.set(context); otherContext[context.length] = 1;
    assert.equal(await f.settle(f.subtle.verify({ name: "Ed448", context: otherContext }, publicKey, expected, message)), false);
  });
}

test("Ed448 absent, undefined, empty and detached contexts use the empty RFC context", async () => {
  const f = fixture();
  const signer = await f.key("Ed448", "private");
  const verifier = await f.key("Ed448", "public");
  const detached = new ArrayBuffer(3);
  structuredClone(detached, { transfer: [detached] });
  for (const algorithm of ["Ed448", { name: "Ed448", context: undefined },
    { name: "Ed448", context: new Uint8Array() }, { name: "Ed448", context: detached }]) {
    const signature = await f.settle(f.subtle.sign(algorithm, signer, ed448Message()));
    assert.deepEqual(new Uint8Array(signature), ed448Signature());
    assert.equal(await f.settle(f.subtle.verify(algorithm, verifier, signature, ed448Message())), true);
    assert.deepEqual(f.provider.signatureParameters, { name: "Ed448", context: new Uint8Array() });
  }
});

test("Ed448 supports contexts through 255 bytes and returns independently owned signatures", async () => {
  const f = fixture();
  const signer = await f.key("Ed448", "private");
  const verifier = await f.key("Ed448", "public");
  const native = createPublicKey({ key: Buffer.from(curve448Spki("Ed448")), format: "der", type: "spki" });
  const message = new Uint8Array([1, 2, 3]);
  for (const length of [1, 254, 255]) {
    const context = new Uint8Array(length).fill(0xa3);
    const algorithm = { name: "Ed448", context };
    const first = await f.settle(f.subtle.sign(algorithm, signer, message));
    const second = await f.settle(f.subtle.sign(algorithm, signer, message));
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    assert.equal(first.byteLength, 114);
    new Uint8Array(first).fill(0);
    const options = { key: native, context };
    assert.equal(verifySignature(null, message, options, new Uint8Array(second)), true);
    assert.equal(await f.settle(f.subtle.verify(algorithm, verifier, second, message)), true);
  }
});

test("Ed448 rejects oversized contexts after key type and before signature-width checks", async () => {
  const f = fixture();
  const signer = await f.key("Ed448", "private");
  const verifier = await f.key("Ed448", "public");
  const privateSlots = getCryptoKeySlots(signer);
  const publicSlots = getCryptoKeySlots(verifier);
  const publicSigner = createCryptoKey("public", false, publicSlots.algorithm, ["sign"], publicSlots.handle);
  const privateVerifier = createCryptoKey("private", false, privateSlots.algorithm, ["verify"], privateSlots.handle);
  const algorithm = { name: "Ed448", context: new Uint8Array(256) };
  await assert.rejects(f.settle(f.subtle.sign(algorithm, publicSigner, new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify(algorithm, privateVerifier, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.sign(algorithm, signer, new Uint8Array())), dom("OperationError"));
  for (const signature of [new Uint8Array(), ed448Signature()]) {
    const pending = f.subtle.verify(algorithm, verifier, signature, ed448Message());
    assert.equal(f.scheduler.hasPending, true);
    await assert.rejects(f.settle(pending), dom("OperationError"));
  }
  assert.equal(f.provider.signs, 0);
  assert.equal(f.provider.verifies, 0);
});

test("Ed448 rejects incorrect signature widths before native verification", async () => {
  const f = fixture();
  const key = await f.key("Ed448", "public");
  for (const length of [0, 57, 64, 113, 115, 228]) {
    assert.equal(await f.settle(f.subtle.verify("Ed448", key, new Uint8Array(length), ed448Message())), false);
  }
  assert.equal(f.provider.verifies, 0);
  assert.equal(await f.settle(f.subtle.verify("Ed448", key, ed448Signature(), ed448Message())), true);
});

test("Ed448 rejects out-of-range scalars and nonzero unused scalar bits", async () => {
  const f = fixture();
  const key = await f.key("Ed448", "public");
  // RFC 8032 §5.2.1 group order, encoded in 57 little-endian octets.
  const order = hex("f34458ab92c27823558fc58d72c26c219036d6ae49db4ec4e923ca7cffffffffffffffffffffffffffffffffffffffffffffffffffffff3f00");
  assert.equal(order.byteLength, 57);
  for (const scalar of [new Uint8Array(57), order, new Uint8Array(57).fill(0xff)]) {
    const signature = ed448Signature(); signature.set(scalar, 57);
    assert.equal(await f.settle(f.subtle.verify("Ed448", key, signature, ed448Message())), false);
  }
  for (const bit of [1, 2, 0x40, 0x80]) {
    const signature = ed448Signature(); signature[113]! |= bit;
    assert.equal(await f.settle(f.subtle.verify("Ed448", key, signature, ed448Message())), false);
  }
});

// RFC 8032 §§5.2.1–5.2.3: p = 2^448 - 2^224 - 1; one extra octet holds x's sign.
const fieldModulus = new Uint8Array(57).fill(0xff); fieldModulus[28] = 0xfe; fieldModulus[56] = 0;
const orderTwo = fieldModulus.slice(); orderTwo[0] = 0xfe;
const noncanonicalIdentity = new Uint8Array(57); noncanonicalIdentity.fill(0xff, 28, 56);
const identity = new Uint8Array(57); identity[0] = 1;
const invalidSign = identity.slice(); invalidSign[56] = 0x80;
const invalidEdPoints = [
  { name: "identity", bytes: identity }, { name: "order two", bytes: orderTwo },
  { name: "order four", bytes: new Uint8Array(57) },
  { name: "field modulus", bytes: fieldModulus },
  { name: "noncanonical identity", bytes: noncanonicalIdentity },
  { name: "invalid identity sign", bytes: invalidSign },
  { name: "out-of-range encoding", bytes: new Uint8Array(57).fill(0xff) },
];

for (const point of invalidEdPoints) {
  test(`Ed448 imports ${point.name} bytes but rejects them as verification A or R`, async () => {
    const f = fixture();
    const key = await f.settle(f.subtle.importKey("raw", point.bytes, "Ed448", true, ["verify"]));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", key)), point.bytes.buffer);
    const forged = new Uint8Array(114); forged[0] = 1; // R = identity, S = 0.
    assert.equal(await f.settle(f.subtle.verify("Ed448", key, forged, new Uint8Array())), false);
    assert.equal(await f.settle(f.subtle.verify("Ed448", key, ed448Signature(), ed448Message())), false);
    const valid = await f.key("Ed448", "public");
    const signature = ed448Signature(); signature.set(point.bytes);
    assert.equal(await f.settle(f.subtle.verify("Ed448", valid, signature, ed448Message())), false);
  });
}

test("Ed448 maps native failures and malformed signature results to queued OperationError", async () => {
  const f = fixture();
  const key = await f.key("Ed448", "private");
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    const pending = f.subtle.sign("Ed448", key, new Uint8Array());
    assert.equal(f.scheduler.hasPending, true);
    await assert.rejects(f.settle(pending), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const result of [
    { kind: "ecdsa", r: new Uint8Array(57), s: new Uint8Array(57) },
    { kind: "bytes", bytes: new Uint8Array() }, { kind: "bytes", bytes: new Uint8Array(64) },
    { kind: "bytes", bytes: new Uint8Array(113) }, { kind: "bytes", bytes: new Uint8Array(115) },
  ] as const) {
    f.provider.returnedSignature = result;
    await assert.rejects(f.settle(f.subtle.sign("Ed448", key, new Uint8Array())), dom("OperationError"));
  }
});

test("Ed448 uses private key snapshots and rejects wrong algorithm or permission", async () => {
  const f = fixture();
  const signer = await f.key("Ed448", "private");
  const verifier = await f.key("Ed448", "public");
  const other = await f.settle(f.subtle.importKey("jwk", ed25519PublicJwk(), "Ed25519", false, ["verify"]));
  await assert.rejects(f.settle(f.subtle.verify("Ed448", other, ed448Signature(), ed448Message())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.sign("Ed448", verifier, ed448Message())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.verify("Ed448", signer, ed448Signature(), ed448Message())), dom("InvalidAccessError"));
  assert.equal(f.provider.signs, 0);
  assert.equal(f.provider.verifies, 0);
  signer.algorithm.name = "Ed25519"; signer.usages.length = 0;
  verifier.algorithm.name = "X448"; verifier.usages.push("deriveBits");
  const signature = await f.settle(f.subtle.sign("Ed448", signer, ed448Message()));
  assert.equal(await f.settle(f.subtle.verify("Ed448", verifier, signature, ed448Message())), true);
});

test("Ed448 borrows context, message and signature view bounds after dictionary conversion", async () => {
  const f = fixture();
  const signer = await f.settle(f.subtle.importKey("jwk", ed448PrivateJwk(2), "Ed448", false, ["sign"]));
  const verifier = await f.settle(f.subtle.importKey("jwk", ed448PublicJwk(2), "Ed448", false, ["verify"]));
  const contextStorage = new Uint8Array([9, 0x66, 0x6f, 0x6f, 8]);
  const message = ed448Message(2);
  const messageStorage = new Uint8Array(message.length + 2); messageStorage.set(message, 1);
  const context = new DataView(contextStorage.buffer, 1, 3);
  const signature = await f.settle(f.subtle.sign({ name: "Ed448", context }, signer,
    new DataView(messageStorage.buffer, 1, message.length)));
  assert.deepEqual(new Uint8Array(signature), ed448Signature(2));
  assert.equal(f.provider.signed!.buffer, messageStorage.buffer);
  assert.equal(f.provider.signed!.byteOffset, 1);
  assert.equal(f.provider.signatureParameters!.name, "Ed448");
  if (f.provider.signatureParameters!.name !== "Ed448") assert.fail("wrong signature parameters");
  assert.equal(f.provider.signatureParameters!.context.buffer, contextStorage.buffer);
  assert.equal(f.provider.signatureParameters!.context.byteOffset, 1);
  assert.equal(f.provider.signatureParameters!.context.byteLength, 3);
  const signatureStorage = new Uint8Array(118); signatureStorage.set(new Uint8Array(signature), 2);
  assert.equal(await f.settle(f.subtle.verify({ name: "Ed448", context }, verifier,
    new DataView(signatureStorage.buffer, 2, 114), message)), true);
});

test("Ed448 executes synchronously and queues settlement while caller inputs may change", async () => {
  const f = fixture();
  const signer = await f.settle(f.subtle.importKey("jwk", ed448PrivateJwk(2), "Ed448", false, ["sign"]));
  const verifier = await f.settle(f.subtle.importKey("jwk", ed448PublicJwk(2), "Ed448", false, ["verify"]));
  const message = ed448Message(2);
  const context = ed448Context(2);
  const pending = f.subtle.sign({ name: "Ed448", context }, signer, message);
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.signed, message);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  message.fill(0); context.fill(0);
  const signature = await f.settle(pending);
  assert.deepEqual(new Uint8Array(signature), ed448Signature(2));
  const verified = f.subtle.verify({ name: "Ed448", context: ed448Context(2) }, verifier, signature, ed448Message(2));
  assert.equal(f.provider.verifies, 1);
  assert.equal(f.scheduler.hasPending, true);
  assert.equal(await f.settle(verified), true);
});

test("X448 derives the exact RFC 7748 shared secret in both directions", async () => {
  const f = fixture();
  for (const [local, peer] of [["alice", "bob"], ["bob", "alice"]] as const) {
    const privateKey = await f.settle(f.subtle.importKey("jwk", x448PrivateJwk(local), "X448", false, ["deriveBits"]));
    const publicKey = await f.settle(f.subtle.importKey("jwk", x448PublicJwk(peer), "X448", false, []));
    const result = await f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey));
    assert.deepEqual(new Uint8Array(result), x448Secret());
    assert.equal(result.byteLength, 56);
    assert.equal(f.provider.agreementKey, getCryptoKeySlots(privateKey).handle);
    assert.deepEqual(f.provider.agreementParameters, { name: "X448", publicKey: getCryptoKeySlots(publicKey).handle });
  }
  assert.equal(f.provider.derives, 2);
  assert.equal(f.provider.digests, 0);
});

for (const index of [0, 1] as const) {
  test(`X448 derives RFC 7748 §5.2 scalar answer ${index + 1}`, async () => {
    const f = fixture();
    const vector = x448ScalarVector(index);
    const prefix = hex("3046020100300506032b656f043a0438");
    const pkcs8 = new Uint8Array(prefix.length + vector.scalar.length); pkcs8.set(prefix); pkcs8.set(vector.scalar, prefix.length);
    const privateKey = await f.settle(f.subtle.importKey("pkcs8", pkcs8, "X448", false, ["deriveBits"]));
    const publicKey = await f.settle(f.subtle.importKey("raw", vector.publicKey, "X448", false, []));
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey))), vector.secret);
  });
}

test("X448 truncates leading bits into exact owned buffers", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X448", public: publicKey };
  const full = x448Secret();
  for (const bits of [0, 1, 7, 8, 9, 13, 447, 448]) {
    const result = await f.settle(f.subtle.deriveBits(algorithm, privateKey, bits));
    const expected = full.slice(0, Math.ceil(bits / 8));
    if (bits % 8 !== 0) expected[expected.length - 1]! &= 0xff << (8 - bits % 8);
    assert.deepEqual(new Uint8Array(result), expected);
    assert.equal(result.byteLength, Math.ceil(bits / 8));
  }
  assert.equal(f.provider.derives, 8, "zero requested bits still perform the whole agreement");
  const first = await f.settle(f.subtle.deriveBits(algorithm, privateKey, null));
  const second = await f.settle(f.subtle.deriveBits(algorithm, privateKey));
  assert.notEqual(first, second);
  new Uint8Array(first).fill(0);
  assert.deepEqual(new Uint8Array(second), full);
});

test("X448 keeps the input top bit and accepts noncanonical field encodings", async () => {
  const f = fixture();
  const { privateKey } = await f.agreement();
  const bob = new Uint8Array(Buffer.from(x448PublicJwk("bob").x, "base64url"));
  bob[55]! ^= 0x80;
  const changed = await f.settle(f.subtle.importKey("raw", bob, "X448", true, []));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw", changed)), bob.buffer);
  const changedSecret = await f.settle(f.subtle.deriveBits({ name: "X448", public: changed }, privateKey));
  assert.notDeepEqual(new Uint8Array(changedSecret), x448Secret(), "X448 does not apply X25519's high-bit mask");
  const basePoint = new Uint8Array(56); basePoint[0] = 5;
  const noncanonical = new Uint8Array(56); noncanonical[0] = 4; noncanonical.fill(0xff, 28); // p + 5.
  const expected = new Uint8Array(Buffer.from(x448PublicJwk("alice").x, "base64url"));
  for (const bytes of [basePoint, noncanonical]) {
    const publicKey = await f.settle(f.subtle.importKey("raw", bytes, "X448", true, []));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw", publicKey)), bytes.buffer);
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey))), expected);
  }
});

test("X448 imports low-order peers but rejects all-zero agreement even for zero bits", async () => {
  const f = fixture();
  const { privateKey } = await f.agreement();
  const one = new Uint8Array(56); one[0] = 1;
  for (const bytes of [new Uint8Array(56), one, orderTwo.subarray(0, 56), fieldModulus.subarray(0, 56), noncanonicalIdentity.subarray(0, 56)]) {
    const publicKey = await f.settle(f.subtle.importKey("raw", bytes, "X448", true, []));
    const exported = await f.settle(f.subtle.exportKey("raw", publicKey));
    assert.ok(exported instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(exported), bytes);
    for (const length of [null, 0, 1, 448]) {
      await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey, length)), dom("OperationError"));
    }
  }
  assert.equal(f.provider.derives, 20);
});

test("X448 scans the complete native secret before truncation or returning zero bits", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X448", public: publicKey };
  f.provider.returnedSecret = new Uint8Array(56);
  for (const length of [null, 0, 1, 8, 448]) {
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, length)), dom("OperationError"));
  }
  for (let index = 0; index < 56; index++) {
    const secret = new Uint8Array(56); secret[index] = 1;
    f.provider.returnedSecret = secret;
    assert.equal((await f.settle(f.subtle.deriveBits(algorithm, privateKey, 0))).byteLength, 0);
  }
  f.provider.returnedSecret = new Uint8Array(56); f.provider.returnedSecret[55] = 1;
  assert.deepEqual(await f.settle(f.subtle.deriveBits(algorithm, privateKey, 8)), new Uint8Array([0]).buffer);
});

test("X448 checks base kind and peer policy before native work, then checks output overflow", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const publicSlots = getCryptoKeySlots(publicKey);
  const publicBase = createCryptoKey("public", false, publicSlots.algorithm, ["deriveBits"], publicSlots.handle);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, publicBase, 449)), dom("InvalidAccessError"));
  const other = await f.settle(f.subtle.importKey("jwk", x25519PublicJwk("bob"), "X25519", false, []));
  for (const peer of [privateKey, other]) {
    await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X448", public: peer }, privateKey, 0xffffffff)), dom("InvalidAccessError"));
  }
  const privateSlots = getCryptoKeySlots(privateKey);
  const wrongName = createCryptoKey("private", false, new KeyAlgorithm("X25519"), ["deriveBits"], privateSlots.handle);
  await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, wrongName, 449)), dom("InvalidAccessError"));
  assert.equal(f.provider.derives, 0);
  for (const length of [449, 0xffffffff]) {
    const before: number = f.provider.derives;
    await assert.rejects(f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey, length)), dom("OperationError"));
    assert.equal(f.provider.derives, before + 1, "Secure Curves checks requested width after native agreement");
  }
});

test("X448 maps native failures and rejects inconsistent complete secret widths", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X448", public: publicKey };
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, null)), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const length of [0, 32, 55, 57]) {
    f.provider.returnedSecret = new Uint8Array(length).fill(1);
    await assert.rejects(f.settle(f.subtle.deriveBits(algorithm, privateKey, 0)), dom("OperationError"));
  }
});

test("X448 uses private metadata snapshots and needs no peer usage", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  privateKey.algorithm.name = "Ed448"; privateKey.usages.length = 0;
  publicKey.algorithm.name = "X25519"; publicKey.usages.push("verify");
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits({ name: "X448", public: publicKey }, privateKey))), x448Secret());
});

test("X448 executes synchronously and queues both success and failure settlement", async () => {
  const f = fixture();
  const { privateKey, publicKey } = await f.agreement();
  const algorithm = { name: "X448", public: publicKey };
  const pending = f.subtle.deriveBits(algorithm, privateKey, 128);
  assert.equal(f.provider.derives, 1);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(new Uint8Array(await f.settle(pending)), x448Secret().subarray(0, 16));
  f.provider.failure = { failure: "operation" };
  const failure = f.subtle.deriveBits(algorithm, privateKey, 128);
  const rejected = assert.rejects(failure, dom("OperationError"));
  assert.equal(f.provider.derives, 2);
  f.scheduler.runPending();
  await rejected;
});
