// Specification controls, not copies of WPT.
// Web Cryptography §§20.9.1–2, 21.4.1–2 and 22.4.1–2:
// https://w3c.github.io/webcrypto/
// RFC 3447 §§7.1, 8.1 and 8.2: https://www.rfc-editor.org/rfc/rfc3447
// Independent known answers: RFC 7520 §§4.1, 4.2 and 5.2 (see rsa-fixtures.ts).
import assert from "node:assert/strict";
import { constants, createPrivateKey, createPublicKey, privateDecrypt, verify as verifySignature } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { createCryptoKey, getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { RsaAlgorithmName } from "../src/crypto/algorithms.ts";
import type {
  CryptoCipherParameters,
  CryptoCiphertext,
  CryptoDigestName,
  CryptoFailure,
  CryptoKeyHandle,
  CryptoSignature,
  CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import {
  rsaOaepCiphertext, rsaOaepMessage, rsaOaepPrivateJwk,
  rsaPkcs1Message, rsaPkcs1Signature, rsaPrivateJwk, rsaPssMessage, rsaPssSignature, rsaPublicJwk,
} from "./rsa-fixtures.ts";

class RecordingProvider extends NodeCryptoProvider {
  signs = 0;
  verifies = 0;
  encrypts = 0;
  decrypts = 0;
  signed: Uint8Array | undefined;
  verified: Uint8Array | undefined;
  signature: CryptoSignature | undefined;
  encrypted: Uint8Array | undefined;
  decrypted: CryptoCiphertext | undefined;
  signatureParameters: CryptoSignatureParameters | undefined;
  cipherParameters: CryptoCipherParameters | undefined;
  failure: CryptoFailure | undefined;
  wrongSignatureKind = false;

  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.signed = data;
    this.signatureParameters = parameters;
    if (this.wrongSignatureKind) return { kind: "ecdsa", r: new Uint8Array(1), s: new Uint8Array(1) };
    return this.failure ?? super.sign(parameters, key, data);
  }

  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, signature: CryptoSignature, data: Uint8Array): boolean {
    this.verifies++;
    this.verified = data;
    this.signature = signature;
    this.signatureParameters = parameters;
    return super.verify(parameters, key, signature, data);
  }

  override encrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoCiphertext | CryptoFailure {
    this.encrypts++;
    this.encrypted = data;
    this.cipherParameters = parameters;
    return this.failure ?? super.encrypt(parameters, key, data);
  }

  override decrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: CryptoCiphertext): Uint8Array | CryptoFailure {
    this.decrypts++;
    this.decrypted = data;
    this.cipherParameters = parameters;
    return this.failure ?? super.decrypt(parameters, key, data);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const random = { fill(bytes: Uint8Array): void { bytes.fill(0x42); } };
  const subtle = createCrypto(random, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: RsaAlgorithmName, hash: CryptoDigestName, type: "public" | "private", usages?: readonly KeyUsage[]): Promise<CryptoKey> {
    const use: readonly KeyUsage[] = usages ?? (name === "RSA-OAEP"
      ? type === "public" ? ["encrypt"] : ["decrypt"]
      : type === "public" ? ["verify"] : ["sign"]);
    return settle(subtle.importKey("jwk", type === "public" ? rsaPublicJwk() : rsaPrivateJwk(), { name, hash }, true, use));
  }
  return { provider, scheduler, subtle, settle, key };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

const hashes: readonly { name: CryptoDigestName; bytes: number }[] = [
  { name: "SHA-1", bytes: 20 },
  { name: "SHA-256", bytes: 32 },
  { name: "SHA-384", bytes: 48 },
  { name: "SHA-512", bytes: 64 },
];

test("RSASSA-PKCS1-v1_5 signs and verifies RFC 7520's exact RS256 answer", async () => {
  const f = fixture();
  const privateKey = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "private");
  const publicKey = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "public");
  const data = rsaPkcs1Message();
  const signature = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data));
  assert.deepEqual(new Uint8Array(signature), rsaPkcs1Signature());
  assert.equal(await f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, rsaPkcs1Signature(), data)), true);
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.verifies, 1);
  assert.equal(f.provider.signed, data);
  assert.equal(signature.byteLength, 256);
  assert.deepEqual(f.provider.signatureParameters, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" });
});

test("RSA-PSS verifies RFC 7520's PS384 answer with exact salt and matching MGF1 hash", async () => {
  const f = fixture();
  const key = await f.key("RSA-PSS", "SHA-384", "public");
  const data = rsaPssMessage();
  const signature = rsaPssSignature();
  assert.equal(await f.settle(f.subtle.verify({ name: "RSA-PSS", saltLength: 48 }, key, signature, data)), true);
  assert.deepEqual(f.provider.signatureParameters, { name: "RSA-PSS", hash: "SHA-384", saltLength: 48 });
  assert.equal(await f.settle(f.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, signature, data)), false);
  const wrongHash = await f.key("RSA-PSS", "SHA-256", "public");
  assert.equal(await f.settle(f.subtle.verify({ name: "RSA-PSS", saltLength: 48 }, wrongHash, signature, data)), false);
});

test("RSA-OAEP decrypts RFC 7520's exact SHA-1 answer with the empty default label", async () => {
  const f = fixture();
  const key = await f.settle(f.subtle.importKey("jwk", rsaOaepPrivateJwk(), { name: "RSA-OAEP", hash: "SHA-1" }, false, ["decrypt"]));
  const ciphertext = rsaOaepCiphertext();
  const plaintext = await f.settle(f.subtle.decrypt("RSA-OAEP", key, ciphertext));
  assert.deepEqual(new Uint8Array(plaintext), rsaOaepMessage());
  assert.equal(f.provider.decrypts, 1);
  assert.equal(f.provider.decrypted!.bytes, ciphertext);
  assert.equal(f.provider.decrypted!.tag, null);
  assert.deepEqual(f.provider.cipherParameters, { name: "RSA-OAEP", hash: "SHA-1", label: new Uint8Array() });
  await assert.rejects(f.settle(f.subtle.decrypt({ name: "RSA-OAEP", label: new Uint8Array([0]) }, key, ciphertext)), dom("OperationError"));
});

for (const hash of hashes) {
  test("RSASSA-PKCS1-v1_5 " + hash.name + " handles empty and nonempty messages with fixed-width owned signatures", async () => {
    const f = fixture();
    const privateKey = await f.key("RSASSA-PKCS1-v1_5", hash.name, "private");
    const publicKey = await f.key("RSASSA-PKCS1-v1_5", hash.name, "public");
    for (const data of [new Uint8Array(), new Uint8Array([1, 2, 3, 4])]) {
      const first = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data));
      const second = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data));
      assert.notEqual(first, second);
      assert.equal(first.byteLength, 256);
      assert.deepEqual(new Uint8Array(first), new Uint8Array(second));
      new Uint8Array(first).fill(0);
      assert.equal(await f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, second, data)), true);
      assert.equal(await f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, first, data)), false);
    }
  });

  test("RSA-PSS " + hash.name + " supports zero, digest-sized and maximum salt and rejects the next length", async () => {
    const f = fixture();
    const privateKey = await f.key("RSA-PSS", hash.name, "private");
    const publicKey = await f.key("RSA-PSS", hash.name, "public");
    const data = new Uint8Array([3, 1, 4, 1, 5]);
    const maximum = 256 - hash.bytes - 2;
    for (const saltLength of [0, hash.bytes, maximum]) {
      const algorithm = { name: "RSA-PSS", saltLength };
      const signature = await f.settle(f.subtle.sign(algorithm, privateKey, data));
      assert.equal(signature.byteLength, 256);
      assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, signature, data)), true);
      assert.equal(await f.settle(f.subtle.verify({ name: "RSA-PSS", saltLength: saltLength + 1 }, publicKey, signature, data)), false);
      const damaged = new Uint8Array(signature.slice(0)); damaged[42]! ^= 1;
      assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, damaged, data)), false);
    }
    for (const saltLength of [maximum + 1, 4_294_967_295]) {
      await assert.rejects(f.settle(f.subtle.sign({ name: "RSA-PSS", saltLength }, privateKey, data)), dom("OperationError"));
      assert.equal(await f.settle(f.subtle.verify({ name: "RSA-PSS", saltLength }, publicKey, new Uint8Array(256), data)), false);
    }
    const zeroSalt = { name: "RSA-PSS", saltLength: 0 };
    const empty = await f.settle(f.subtle.sign(zeroSalt, privateKey, new Uint8Array()));
    assert.equal(await f.settle(f.subtle.verify(zeroSalt, publicKey, empty, new Uint8Array())), true);
  });

  test("RSA-OAEP " + hash.name + " handles empty and maximum plaintext with a borrowed label", async () => {
    const f = fixture();
    const publicKey = await f.key("RSA-OAEP", hash.name, "public");
    const privateKey = await f.key("RSA-OAEP", hash.name, "private");
    const label = new Uint8Array([0, 255, 128, 1]);
    const algorithm = { name: "RSA-OAEP", label };
    const maximum = 256 - 2 * hash.bytes - 2;
    for (const length of [0, 1, maximum]) {
      const data = new Uint8Array(length).fill(0x61);
      const encrypted = await f.settle(f.subtle.encrypt(algorithm, publicKey, data));
      assert.equal(encrypted.byteLength, 256);
      assert.equal(f.provider.encrypted, data);
      assert.equal(f.provider.cipherParameters!.name, "RSA-OAEP");
      assert.ok(f.provider.cipherParameters!.name === "RSA-OAEP");
      assert.equal(f.provider.cipherParameters!.label, label);
      assert.equal(f.provider.cipherParameters!.hash, hash.name);
      const decrypted = await f.settle(f.subtle.decrypt(algorithm, privateKey, encrypted));
      assert.deepEqual(new Uint8Array(decrypted), data);
      assert.equal(decrypted.byteLength, length);
      await assert.rejects(f.settle(f.subtle.decrypt("RSA-OAEP", privateKey, encrypted)), dom("OperationError"));
    }
    await assert.rejects(f.settle(f.subtle.encrypt(algorithm, publicKey, new Uint8Array(maximum + 1))), dom("OperationError"));
  });
}

test("RSA verification returns false for truncated, oversized, altered and wrong-message signatures", async () => {
  const f = fixture();
  for (const name of ["RSASSA-PKCS1-v1_5", "RSA-PSS"] as const) {
    const hash = name === "RSA-PSS" ? "SHA-384" : "SHA-256";
    const key = await f.key(name, hash, "public");
    const algorithm = name === "RSA-PSS" ? { name, saltLength: 48 } : { name };
    const signature = name === "RSA-PSS" ? rsaPssSignature() : rsaPkcs1Signature();
    const data = name === "RSA-PSS" ? rsaPssMessage() : rsaPkcs1Message();
    const changed = signature.slice(); changed[0]! ^= 1;
    const extended = new Uint8Array(257); extended.set(signature, 1);
    for (const invalid of [new Uint8Array(), signature.subarray(1), extended, changed, new Uint8Array(256).fill(255)]) {
      assert.equal(await f.settle(f.subtle.verify(algorithm, key, invalid, data)), false);
    }
    assert.equal(await f.settle(f.subtle.verify(algorithm, key, signature, data.subarray(1))), false);
  }
});

test("RSA-OAEP rejects wrong length, altered ciphertext, modulus-or-larger integer and mismatched hash", async () => {
  const f = fixture();
  const publicKey = await f.key("RSA-OAEP", "SHA-256", "public");
  const privateKey = await f.key("RSA-OAEP", "SHA-256", "private");
  const encrypted = new Uint8Array(await f.settle(f.subtle.encrypt("RSA-OAEP", publicKey, new Uint8Array([1, 2, 3]))));
  const changed = encrypted.slice(); changed[changed.length - 1]! ^= 1;
  const extended = new Uint8Array(257); extended.set(encrypted, 1);
  const modulus = new Uint8Array(Buffer.from(rsaPublicJwk().n, "base64url"));
  for (const invalid of [new Uint8Array(), encrypted.subarray(1), extended, changed, modulus, new Uint8Array(256).fill(255)]) {
    await assert.rejects(f.settle(f.subtle.decrypt("RSA-OAEP", privateKey, invalid)), dom("OperationError"));
  }
  const wrongHash = await f.key("RSA-OAEP", "SHA-1", "private");
  await assert.rejects(f.settle(f.subtle.decrypt("RSA-OAEP", wrongHash, encrypted)), dom("OperationError"));
});

test("RSA-OAEP rejects a valid ciphertext with its leading zero removed before native decryption", async () => {
  const f = fixture();
  const key = await f.key("RSA-OAEP", "SHA-256", "private");
  // Fixed Node-primitive encryption of the RFC 7520 fixture key. Unlike the RFC
  // vectors above, this is a locally generated length-policy control: native
  // privateDecrypt accepts the short encoding, but RFC 3447 §7.1.2 forbids it.
  const ciphertext = new Uint8Array(Buffer.from(
    "005f197a7b244ee84cd9a5d15ef09cfd23e09d511ee965519ffe6da241749feace"
    + "b02456f7701fe261d7e7a8c13709567ba870ab56dac316c3f3658dc5a57b48797"
    + "b9c6034e7ff5430453ae8c061d6e440b3a20d55600d21ca649d6a14f80276d260"
    + "3a6ddd04e4ca9904222cf45928c2254d5e32e9e077453e71180700d82867c12bec"
    + "7f44d9d4faaccb9acb69f44786ea05295ee86d2d03a78c82baa5879751a409d14b"
    + "d38afea6d4991bc620cf2662376d834b7b94dada8672a36ffe2c221a45bdf7fded"
    + "c621338a39549c0833f46b52a1547232b4622d2a2bb5348a3061082a6548832b95"
    + "70f30391c24a846f4dede3e0e5f3a05ad959ea87f2bf5051887f", "hex",
  ));
  const expected = Buffer.from("OAEP requires an exact ciphertext width.");
  assert.deepEqual(Buffer.from(await f.settle(f.subtle.decrypt("RSA-OAEP", key, ciphertext))), expected);
  const short = ciphertext.subarray(1);
  assert.deepEqual(privateDecrypt({
    key: createPrivateKey({ key: { ...rsaPrivateJwk() }, format: "jwk" }),
    padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256",
  }, short), expected);
  await assert.rejects(f.settle(f.subtle.decrypt("RSA-OAEP", key, short)), dom("OperationError"));
  assert.equal(f.provider.decrypts, 1, "the shared byte-width check must run before the primitive");
});

test("RSA-PSS rejects a valid signature with its leading zero removed before native verification", async () => {
  const f = fixture();
  const privateKey = await f.key("RSA-PSS", "SHA-256", "private");
  const publicKey = await f.key("RSA-PSS", "SHA-256", "public");
  // This fixed message gives a leading-zero signature for the fixture key and
  // zero salt. Node's PSS verifier accepts its short form, unlike RFC 3447 §8.1.2.
  const data = new Uint8Array(Buffer.from("RSA fixed signature width 164"));
  const algorithm = { name: "RSA-PSS", saltLength: 0 };
  const signature = new Uint8Array(await f.settle(f.subtle.sign(algorithm, privateKey, data)));
  assert.equal(signature[0], 0);
  assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, signature, data)), true);
  const short = signature.subarray(1);
  assert.equal(verifySignature("sha256", data, {
    key: createPublicKey({ key: { ...rsaPublicJwk() }, format: "jwk" }),
    padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 0,
  }, short), true);
  assert.equal(await f.settle(f.subtle.verify(algorithm, publicKey, short, data)), false);
  assert.equal(f.provider.verifies, 1, "the shared signature-width check must run before the primitive");
});

test("RSA type checks prevent native calls even when an internal test key supplies otherwise-permitted usages", async () => {
  const f = fixture();
  for (const name of ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"] as const) {
    const real = await f.key(name, "SHA-256", "private");
    const slots = getCryptoKeySlots(real);
    const wrongPublic = createCryptoKey("public", true, slots.algorithm, ["sign", "decrypt"], slots.handle);
    const wrongPrivate = createCryptoKey("private", true, slots.algorithm, ["verify", "encrypt"], slots.handle);
    if (name === "RSA-OAEP") {
      await assert.rejects(f.settle(f.subtle.encrypt(name, wrongPrivate, new Uint8Array())), dom("InvalidAccessError"));
      await assert.rejects(f.settle(f.subtle.decrypt(name, wrongPublic, new Uint8Array())), dom("InvalidAccessError"));
    } else {
      const algorithm = name === "RSA-PSS" ? { name, saltLength: 0 } : { name };
      await assert.rejects(f.settle(f.subtle.sign(algorithm, wrongPublic, new Uint8Array())), dom("InvalidAccessError"));
      await assert.rejects(f.settle(f.subtle.verify(algorithm, wrongPrivate, new Uint8Array(), new Uint8Array())), dom("InvalidAccessError"));
    }
  }
  assert.equal(f.provider.signs + f.provider.verifies + f.provider.encrypts + f.provider.decrypts, 0);
});

test("RSA permission and algorithm checks use private slots despite modified public snapshots", async () => {
  const f = fixture();
  const signKey = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "private");
  const emptyPublic = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "public", []);
  signKey.algorithm.name = "RSA-PSS";
  signKey.usages[0] = "verify";
  emptyPublic.usages.push("verify");
  const signed = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", signKey, rsaPkcs1Message()));
  assert.deepEqual(new Uint8Array(signed), rsaPkcs1Signature());
  await assert.rejects(f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", emptyPublic, signed, rsaPkcs1Message())), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, signKey, rsaPkcs1Message())), dom("InvalidAccessError"));
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.verifies, 0);
});

test("RSA sign and OAEP failures cross as scheduled OperationError for both native failure values", async () => {
  const f = fixture();
  const signer = await f.key("RSA-PSS", "SHA-256", "private");
  const publicKey = await f.key("RSA-OAEP", "SHA-256", "public");
  const privateKey = await f.key("RSA-OAEP", "SHA-256", "private");
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.failure = { failure };
    for (const operation of [
      () => f.subtle.sign({ name: "RSA-PSS", saltLength: 0 }, signer, new Uint8Array()),
      () => f.subtle.encrypt("RSA-OAEP", publicKey, new Uint8Array()),
      () => f.subtle.decrypt("RSA-OAEP", privateKey, new Uint8Array(256)),
    ]) {
      const promise = operation();
      let rejected = false;
      const observed = promise.catch((error: unknown) => { rejected = true; throw error; });
      await Promise.resolve();
      assert.equal(rejected, false);
      const assertion = assert.rejects(observed, dom("OperationError"));
      f.scheduler.runPending();
      await assertion;
    }
  }
});

test("RSA signing rejects a malformed native signature result", async () => {
  const f = fixture();
  const key = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "private");
  f.provider.wrongSignatureKind = true;
  await assert.rejects(f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", key, new Uint8Array())), dom("OperationError"));
});

test("RSA operations execute synchronously and settle only from the scheduled crypto task", async () => {
  const f = fixture();
  const key = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "private");
  const data = rsaPkcs1Message();
  const promise = f.subtle.sign("RSASSA-PKCS1-v1_5", key, data);
  assert.equal(f.provider.signs, 1);
  assert.equal(f.provider.signed, data);
  let resolved = false;
  const observed = promise.then(value => { resolved = true; return value; });
  data.fill(0);
  await Promise.resolve();
  assert.equal(resolved, false);
  f.scheduler.runPending();
  assert.deepEqual(new Uint8Array(await observed), rsaPkcs1Signature());
  assert.equal(resolved, true);
});

test("RSA-PSS normalization errors reject before a native call or crypto task", async () => {
  const f = fixture();
  const key = await f.key("RSA-PSS", "SHA-256", "private");
  for (const saltLength of [undefined, -1, Infinity, 1n, 4_294_967_296]) {
    await assert.rejects(f.subtle.sign({ name: "RSA-PSS", saltLength }, key, new Uint8Array()), TypeError);
    assert.equal(f.scheduler.hasPending, false);
  }
  assert.equal(f.provider.signs, 0);
});

test("RSA-PSS signature and data bytes are read after salt coercion", async () => {
  const f = fixture();
  const key = await f.key("RSA-PSS", "SHA-384", "public");
  const expectedSignature = rsaPssSignature();
  const expectedData = rsaPssMessage();
  const signature = new Uint8Array(expectedSignature.length);
  const data = new Uint8Array(expectedData.length);
  assert.equal(await f.settle(f.subtle.verify({
    name: "RSA-PSS",
    saltLength: { valueOf() { signature.set(expectedSignature); data.set(expectedData); return 48; } },
  }, key, signature, data)), true);
  assert.equal(f.provider.verified, data);
  assert.ok(f.provider.signature!.kind === "bytes");
  assert.equal(f.provider.signature!.bytes, signature);
});

test("RSA messages support nonzero view offsets and detached empty inputs", async () => {
  const f = fixture();
  const privateKey = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "private");
  const publicKey = await f.key("RSASSA-PKCS1-v1_5", "SHA-256", "public");
  const expected = rsaPkcs1Message();
  const storage = new Uint8Array(expected.length + 8); storage.set(expected, 4);
  const data = new DataView(storage.buffer, 4, expected.length);
  const signature = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data));
  assert.deepEqual(new Uint8Array(signature), rsaPkcs1Signature());
  assert.equal(f.provider.signed!.buffer, storage.buffer);
  assert.equal(f.provider.signed!.byteOffset, 4);
  assert.equal(f.provider.signed!.byteLength, expected.length);
  const signatureStorage = new Uint8Array(260); signatureStorage.set(new Uint8Array(signature), 2);
  assert.equal(await f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, new DataView(signatureStorage.buffer, 2, 256), data)), true);
  const buffer = new ArrayBuffer(4);
  const detached = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  const signedEmpty = await f.settle(f.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, detached));
  assert.equal(await f.settle(f.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signedEmpty, new Uint8Array())), true);
});

test("RSA operations reject shared and resizable data before algorithm dictionary getters", async () => {
  const f = fixture();
  const key = await f.key("RSA-PSS", "SHA-256", "private");
  for (const data of [new SharedArrayBuffer(0), new Uint8Array(new SharedArrayBuffer(0)), new ArrayBuffer(0, { maxByteLength: 4 })]) {
    await assert.rejects(f.subtle.sign({ get name() { throw new Error("algorithm must not normalize"); } }, key, data), TypeError);
  }
  assert.equal(f.provider.signs, 0);
});

test("RSA-OAEP labels preserve arbitrary bytes and data changes made by the label getter", async () => {
  const f = fixture();
  const publicKey = await f.key("RSA-OAEP", "SHA-256", "public");
  const privateKey = await f.key("RSA-OAEP", "SHA-256", "private");
  const data = new Uint8Array(4);
  const labelStorage = new Uint8Array([9, 0, 255, 1, 8]);
  const label = new DataView(labelStorage.buffer, 1, 3);
  const ciphertext = await f.settle(f.subtle.encrypt({
    name: "RSA-OAEP",
    get label() { data.fill(7); return label; },
  }, publicKey, data));
  assert.equal(f.provider.cipherParameters!.name, "RSA-OAEP");
  assert.ok(f.provider.cipherParameters!.name === "RSA-OAEP");
  assert.equal(f.provider.cipherParameters!.label.buffer, labelStorage.buffer);
  assert.equal(f.provider.cipherParameters!.label.byteOffset, 1);
  assert.equal(f.provider.cipherParameters!.label.byteLength, 3);
  const decrypted = await f.settle(f.subtle.decrypt({ name: "RSA-OAEP", label }, privateKey, ciphertext));
  assert.deepEqual(new Uint8Array(decrypted), new Uint8Array(4).fill(7));
});

test("RSA key handles work across compatible provider instances without exporting the private key", async () => {
  const first = fixture();
  const second = fixture();
  const privateKey = await first.settle(first.subtle.importKey("jwk", rsaPrivateJwk(), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]));
  const publicKey = await first.key("RSASSA-PKCS1-v1_5", "SHA-256", "public");
  const signature = await second.settle(second.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, rsaPkcs1Message()));
  assert.deepEqual(new Uint8Array(signature), rsaPkcs1Signature());
  assert.equal(await second.settle(second.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, rsaPkcs1Message())), true);
});
