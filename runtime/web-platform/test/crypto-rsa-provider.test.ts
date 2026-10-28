// Controls for the ordinary-Node RSA primitive fixture, independent of the
// shared Web Crypto algorithms. Known answers: RFC 7520 §§4.1, 4.2 and 5.2.
// https://www.rfc-editor.org/rfc/rfc7520.html
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { constants, createPrivateKey, privateDecrypt, verify } from "node:crypto";
import test from "node:test";
import type {
  CryptoDigestName,
  CryptoFailure,
  CryptoKeyHandle,
  CryptoKeyRecord,
  CryptoRsaComponents,
} from "../src/provider/crypto.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import {
  rsaOaepCiphertext,
  rsaOaepMessage,
  rsaOaepPrivateJwk,
  rsaPkcs1Message,
  rsaPkcs1Signature,
  rsaPkcs8,
  rsaPrivateJwk,
  rsaPssMessage,
  rsaPssSignature,
  rsaSpki,
} from "./rsa-fixtures.ts";
import type { RsaFixturePrivateJwk } from "./rsa-fixtures.ts";

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function decoded(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function privateComponents(jwk: RsaFixturePrivateJwk = rsaPrivateJwk()): CryptoRsaComponents {
  return {
    family: "RSA", n: decoded(jwk.n), e: decoded(jwk.e), d: decoded(jwk.d),
    p: decoded(jwk.p), q: decoded(jwk.q), dp: decoded(jwk.dp), dq: decoded(jwk.dq), qi: decoded(jwk.qi),
  };
}

function publicKey(provider: NodeCryptoProvider): CryptoKeyRecord {
  return success(provider.importKey({ format: "spki", bytes: rsaSpki() }));
}

function privateKey(provider: NodeCryptoProvider): CryptoKeyRecord {
  return success(provider.importKey({ format: "pkcs8", bytes: rsaPkcs8() }));
}

function assertOwned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.byteLength, bytes.buffer.byteLength);
}

test("native RSA imports report actual key kind, modulus bits and minimal exponent bytes", () => {
  const provider = new NodeCryptoProvider();
  for (const format of ["spki", "pkcs8"] as const) {
    const imported = success(provider.importKey({ format, bytes: format === "spki" ? rsaSpki() : rsaPkcs8() }));
    assert.deepEqual(imported.info, {
      family: "RSA", type: format === "spki" ? "public" : "private", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    });
    assert.deepEqual(Object.keys(imported.handle), []);
    assert.ok(imported.info.family === "RSA");
    assertOwned(imported.info.publicExponent);
  }
});

test("native RSA DER imports own material and DER exports have exact independent buffers", () => {
  const provider = new NodeCryptoProvider();
  for (const format of ["spki", "pkcs8"] as const) {
    const expected = format === "spki" ? rsaSpki() : rsaPkcs8();
    const input = new Uint8Array(expected);
    const imported = success(provider.importKey({ format, bytes: input }));
    input.fill(0);
    const first = success(provider.exportKey(imported.handle, format));
    const second = success(provider.exportKey(imported.handle, format));
    assert.deepEqual(first, expected);
    assertOwned(first);
    assertOwned(second);
    assert.notEqual(first.buffer, second.buffer);
    first.fill(0);
    assert.deepEqual(second, expected);
  }
});

test("native RSA component imports and exports never alias handles, metadata or one another", () => {
  const provider = new NodeCryptoProvider();
  const input = privateComponents();
  const imported = success(provider.importKey({ format: "components", components: input }));
  const expected = privateComponents();
  input.n.fill(0);
  input.e.fill(0);
  input.d!.fill(0);
  const first = success(provider.exportComponents(imported.handle));
  const second = success(provider.exportComponents(imported.handle));
  assert.deepEqual(first, expected);
  assert.ok(first.family === "RSA" && second.family === "RSA" && imported.info.family === "RSA");
  for (const name of ["n", "e", "d", "p", "q", "dp", "dq", "qi"] as const) {
    assertOwned(first[name]!);
    assert.notEqual(first[name]!.buffer, second[name]!.buffer);
    first[name]!.fill(0);
  }
  imported.info.publicExponent.fill(0);
  assert.deepEqual(second, expected);
  assert.deepEqual(success(provider.exportComponents(imported.handle)), expected);
  const signature = success(provider.sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, imported.handle, rsaPkcs1Message()));
  assert.ok(signature.kind === "bytes");
  assert.deepEqual(signature.bytes, rsaPkcs1Signature());
});

test("native RSA public component import preserves n/e and compatible provider handles", () => {
  const first = new NodeCryptoProvider();
  const second = new NodeCryptoProvider();
  const jwk = rsaPrivateJwk();
  const n = decoded(jwk.n);
  const e = decoded(jwk.e);
  const imported = success(first.importKey({ format: "components", components: { family: "RSA", n, e } }));
  n.fill(0);
  e.fill(0);
  assert.deepEqual(success(second.exportKey(imported.handle, "spki")), rsaSpki());
  assert.deepEqual(success(second.exportComponents(imported.handle)), { family: "RSA", n: decoded(jwk.n), e: decoded(jwk.e) });
  assert.equal(second.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, imported.handle,
    { kind: "bytes", bytes: rsaPkcs1Signature() }, rsaPkcs1Message()), true);
});

test("native RSA multi-prime component and PKCS8 round trips preserve every other-prime value", () => {
  // Fixed tiny three-prime encoding control. This is not a usable signing key
  // size; it isolates version-one ASN.1 and the optional component structure.
  const provider = new NodeCryptoProvider();
  const one = (value: number): Uint8Array => new Uint8Array([value]);
  const components: CryptoRsaComponents = {
    family: "RSA", n: one(105), e: one(5), d: one(5), p: one(3), q: one(5),
    dp: one(1), dq: one(1), qi: one(2), oth: [{ r: one(7), d: one(5), t: one(1) }],
  };
  const key = success(provider.importKey({ format: "components", components }));
  const exported = success(provider.exportComponents(key.handle));
  assert.deepEqual(exported, components);
  assert.ok(exported.family === "RSA" && exported.oth !== undefined);
  for (const part of ["r", "d", "t"] as const) {
    assertOwned(exported.oth[0]![part]);
    assert.notEqual(exported.oth[0]![part].buffer, components.oth![0]![part].buffer);
  }
  const der = success(provider.exportKey(key.handle, "pkcs8"));
  const reimported = success(provider.importKey({ format: "pkcs8", bytes: der }));
  assert.deepEqual(success(provider.exportComponents(reimported.handle)), components);
});

test("native RSA exports reject unsupported key-kind encodings as failure values", () => {
  const provider = new NodeCryptoProvider();
  const privateRecord = privateKey(provider);
  const publicRecord = publicKey(provider);
  assert.deepEqual(provider.exportKey(privateRecord.handle, "spki"), { failure: "operation" });
  assert.deepEqual(provider.exportKey(publicRecord.handle, "pkcs8"), { failure: "operation" });
  assert.deepEqual(provider.exportKey(privateRecord.handle, "raw"), { failure: "operation" });
  assert.deepEqual(provider.exportKey(publicRecord.handle, "raw"), { failure: "operation" });
});

test("native RSA generation reports actual metadata and independent public/private handles", () => {
  const provider = new NodeCryptoProvider();
  for (const publicExponent of [new Uint8Array([3]), new Uint8Array([0, 1, 0, 1])]) {
    const pair = success(provider.generateKeyPair({ family: "RSA", modulusLength: 1024, publicExponent }));
    assert.notEqual(pair.privateKey.handle, pair.publicKey.handle);
    assert.ok(pair.privateKey.info.family === "RSA" && pair.publicKey.info.family === "RSA");
    assert.equal(pair.privateKey.info.type, "private");
    assert.equal(pair.publicKey.info.type, "public");
    assert.equal(pair.publicKey.info.modulusLength, 1024);
    assert.equal(pair.privateKey.info.modulusLength, 1024);
    const expected = publicExponent.length === 1 ? new Uint8Array([3]) : new Uint8Array([1, 0, 1]);
    assert.deepEqual(pair.publicKey.info.publicExponent, expected);
    assert.deepEqual(pair.privateKey.info.publicExponent, expected);
    assert.notEqual(pair.publicKey.info.publicExponent.buffer, pair.privateKey.info.publicExponent.buffer);
    assert.notEqual(pair.publicKey.info.publicExponent.buffer, publicExponent.buffer);
    const signature = success(provider.sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, pair.privateKey.handle, rsaPkcs1Message()));
    assert.equal(provider.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, pair.publicKey.handle, signature, rsaPkcs1Message()), true);
  }
});

test("native RSA generation failures cross as operation values", () => {
  const provider = new NodeCryptoProvider();
  for (const parameters of [
    { family: "RSA", modulusLength: 0, publicExponent: new Uint8Array([1, 0, 1]) },
    { family: "RSA", modulusLength: 1024, publicExponent: new Uint8Array([2]) },
    { family: "RSA", modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 0, 0, 1]) },
  ] as const) assert.deepEqual(provider.generateKeyPair(parameters), { failure: "operation" });
});

test("native Node fixture explicitly reports its n/e/d-only import limitation", () => {
  const provider = new NodeCryptoProvider();
  const jwk = rsaPrivateJwk();
  assert.deepEqual(provider.importKey({
    format: "components", components: { family: "RSA", n: decoded(jwk.n), e: decoded(jwk.e), d: decoded(jwk.d) },
  }), { failure: "operation" });
  // This is a test-adapter limitation, not a shared Web Crypto rejection.
  // Node does not expose native CRT recovery or key validation; OpenSSL/JCA
  // bindings receive the decoded optional components without this restriction.
});

test("native RSA malformed encodings and foreign handles return failures without throwing", () => {
  const provider = new NodeCryptoProvider();
  const foreign = {} as CryptoKeyHandle;
  assert.deepEqual(provider.importKey({ format: "spki", bytes: new Uint8Array([0x30, 0]) }), { failure: "invalid-key" });
  assert.deepEqual(provider.importKey({ format: "pkcs8", bytes: new Uint8Array([0x30, 0]) }), { failure: "invalid-key" });
  const parameters = { name: "RSA-OAEP", hash: "SHA-256", label: new Uint8Array() } as const;
  const signatureParameters = { name: "RSA-PSS", hash: "SHA-256", saltLength: 32 } as const;
  assert.deepEqual(provider.encrypt(parameters, foreign, new Uint8Array()), { failure: "invalid-key" });
  assert.deepEqual(provider.decrypt(parameters, foreign, { bytes: new Uint8Array(), tag: null }), { failure: "invalid-key" });
  assert.deepEqual(provider.sign(signatureParameters, foreign, new Uint8Array()), { failure: "invalid-key" });
  assert.equal(provider.verify(signatureParameters, foreign, { kind: "bytes", bytes: new Uint8Array() }, new Uint8Array()), false);
});

test("native RSASSA-PKCS1-v1_5 reproduces RFC 7520 figure 12 exactly", () => {
  const provider = new NodeCryptoProvider();
  const privateRecord = privateKey(provider);
  const publicRecord = publicKey(provider);
  const parameters = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
  const signature = success(provider.sign(parameters, privateRecord.handle, rsaPkcs1Message()));
  assert.ok(signature.kind === "bytes");
  assertOwned(signature.bytes);
  assert.deepEqual(signature.bytes, rsaPkcs1Signature());
  assert.equal(provider.verify(parameters, publicRecord.handle, signature, rsaPkcs1Message()), true);
  signature.bytes[0] = signature.bytes[0]! ^ 1;
  assert.equal(provider.verify(parameters, publicRecord.handle, signature, rsaPkcs1Message()), false);
  assert.equal(provider.verify(parameters, publicRecord.handle, { kind: "bytes", bytes: new Uint8Array(255) }, rsaPkcs1Message()), false);
  assert.equal(provider.verify(parameters, publicRecord.handle, { kind: "bytes", bytes: new Uint8Array(257) }, rsaPkcs1Message()), false);
  assert.equal(provider.verify(parameters, publicRecord.handle, { kind: "ecdsa", r: new Uint8Array(), s: new Uint8Array() }, rsaPkcs1Message()), false);
});

test("native RSA-PSS verifies RFC 7520 PS384 with the exact hash and salt length", () => {
  const provider = new NodeCryptoProvider();
  const key = publicKey(provider);
  const parameters = { name: "RSA-PSS", hash: "SHA-384", saltLength: 48 } as const;
  const signature = { kind: "bytes", bytes: rsaPssSignature() } as const;
  assert.equal(provider.verify(parameters, key.handle, signature, rsaPssMessage()), true);
  assert.equal(provider.verify({ ...parameters, saltLength: 47 }, key.handle, signature, rsaPssMessage()), false);
  assert.equal(provider.verify({ ...parameters, hash: "SHA-256" }, key.handle, signature, rsaPssMessage()), false);
  assert.equal(provider.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, key.handle, signature, rsaPssMessage()), false);
  signature.bytes[0] = signature.bytes[0]! ^ 1;
  assert.equal(provider.verify(parameters, key.handle, signature, rsaPssMessage()), false);
});

for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const satisfies readonly CryptoDigestName[]) {
  test(`native RSA-PSS selects ${hash} for hashing and MGF1 with an explicit salt`, () => {
    const provider = new NodeCryptoProvider();
    const key = privateKey(provider);
    const parameters = { name: "RSA-PSS", hash, saltLength: 0 } as const;
    const signature = success(provider.sign(parameters, key.handle, rsaPssMessage()));
    const repeat = success(provider.sign(parameters, key.handle, rsaPssMessage()));
    assert.ok(signature.kind === "bytes" && repeat.kind === "bytes");
    assertOwned(signature.bytes);
    assert.notEqual(signature.bytes.buffer, repeat.bytes.buffer);
    assert.deepEqual(signature.bytes, repeat.bytes, "zero-salt PSS is deterministic");
    // An independent native verification call fixes both padding and salt size.
    assert.equal(verify(hash.toLowerCase().replace("-", ""), rsaPssMessage(), {
      key: createPrivateKey({ key: { ...rsaPrivateJwk() }, format: "jwk" }),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 0,
    }, signature.bytes), true);
  });
}

test("native RSA-PSS impossible salt sizes return failures and verification false", () => {
  const provider = new NodeCryptoProvider();
  const parameters = { name: "RSA-PSS", hash: "SHA-256", saltLength: 0xffffffff } as const;
  assert.deepEqual(provider.sign(parameters, privateKey(provider).handle, rsaPssMessage()), { failure: "operation" });
  assert.equal(provider.verify(parameters, publicKey(provider).handle, { kind: "bytes", bytes: rsaPssSignature() }, rsaPssMessage()), false);
});

test("native RSA-OAEP decrypts RFC 7520 figure 87 with SHA-1 and an empty label", () => {
  const provider = new NodeCryptoProvider();
  const key = success(provider.importKey({ format: "components", components: privateComponents(rsaOaepPrivateJwk()) }));
  const parameters = { name: "RSA-OAEP", hash: "SHA-1", label: new Uint8Array() } as const;
  const ciphertext = rsaOaepCiphertext();
  const decrypted = success(provider.decrypt(parameters, key.handle, { bytes: ciphertext, tag: null }));
  assertOwned(decrypted);
  assert.deepEqual(decrypted, rsaOaepMessage());
  assert.deepEqual(ciphertext, rsaOaepCiphertext());
  assert.deepEqual(provider.decrypt({ ...parameters, label: new Uint8Array([1]) }, key.handle,
    { bytes: ciphertext, tag: null }), { failure: "operation" });
  assert.deepEqual(provider.decrypt({ ...parameters, hash: "SHA-256" }, key.handle,
    { bytes: ciphertext, tag: null }), { failure: "operation" });
  ciphertext[0] = ciphertext[0]! ^ 1;
  assert.deepEqual(provider.decrypt(parameters, key.handle, { bytes: ciphertext, tag: null }), { failure: "operation" });
});

for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const satisfies readonly CryptoDigestName[]) {
  test(`native RSA-OAEP selects ${hash} for the message hash and MGF1 and preserves the label`, () => {
    const provider = new NodeCryptoProvider();
    const key = publicKey(provider);
    const label = new Uint8Array([0, 255, 1, 2, 128]);
    const message = new Uint8Array([0, 1, 2, 3]);
    const encrypted = success(provider.encrypt({ name: "RSA-OAEP", hash, label }, key.handle, message));
    assertOwned(encrypted.bytes);
    assert.equal(encrypted.tag, null);
    assert.equal(encrypted.bytes.length, 256);
    assert.deepEqual(label, new Uint8Array([0, 255, 1, 2, 128]));
    const plaintext = privateDecrypt({
      key: createPrivateKey({ key: { ...rsaPrivateJwk() }, format: "jwk" }),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: hash.toLowerCase().replace("-", ""),
      oaepLabel: label,
    }, encrypted.bytes);
    assert.deepEqual(new Uint8Array(plaintext), message);
  });
}

test("native RSA-OAEP decryption failure never returns partial plaintext", () => {
  const provider = new NodeCryptoProvider();
  const parameters = { name: "RSA-OAEP", hash: "SHA-256", label: new Uint8Array() } as const;
  const key = privateKey(provider);
  for (const length of [0, 1, 255, 256, 257]) {
    assert.deepEqual(provider.decrypt(parameters, key.handle, { bytes: new Uint8Array(length), tag: null }), { failure: "operation" });
  }
  assert.deepEqual(provider.encrypt(parameters, publicKey(provider).handle, new Uint8Array(191)), { failure: "operation" });
});
