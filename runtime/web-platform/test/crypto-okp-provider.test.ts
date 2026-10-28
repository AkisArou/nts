// Native capability controls: Web Cryptography §§25–26, RFC 8032 §7.1,
// RFC 7748 §§5.2/6.1 and RFC 8410. No host Web Crypto implementation is used.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey } from "node:crypto";
import test from "node:test";
import type { CryptoFailure, CryptoKeyHandle, CryptoKeyRecord, CryptoOkpComponents } from "../src/provider/crypto.ts";
import {
  ed25519Message, ed25519PrivateJwk, ed25519PublicJwk, ed25519Signature,
  okpPkcs8, okpPrivateJwk, okpPublicJwk, okpRawPublic, okpSpki,
  x25519PrivateJwk, x25519PublicJwk, x25519ScalarVector, x25519Secret,
} from "./okp-fixtures.ts";
import type { OkpFixtureName, OkpFixturePrivateJwk, OkpFixturePublicJwk } from "./okp-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function components(jwk: OkpFixturePublicJwk | OkpFixturePrivateJwk): CryptoOkpComponents {
  const publicComponents: CryptoOkpComponents = {
    family: "OKP", namedCurve: jwk.crv, x: new Uint8Array(Buffer.from(jwk.x, "base64url")),
  };
  return "d" in jwk ? { ...publicComponents, d: new Uint8Array(Buffer.from(jwk.d, "base64url")) } : publicComponents;
}

function imported(provider: NodeCryptoProvider, name: OkpFixtureName, type: "public" | "private"): CryptoKeyRecord {
  return success(provider.importKey({
    format: type === "public" ? "spki" : "pkcs8", bytes: type === "public" ? okpSpki(name) : okpPkcs8(name),
  }));
}

function assertOwned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.byteLength, bytes.buffer.byteLength);
}

for (const name of ["Ed25519", "X25519"] as const) {
  test(`native ${name} imports raw, SPKI, PKCS8 and components with actual metadata`, () => {
    const provider = new NodeCryptoProvider();
    const inputs = [
      { format: "raw", family: "OKP", namedCurve: name, bytes: okpRawPublic(name) },
      { format: "spki", bytes: okpSpki(name) },
      { format: "pkcs8", bytes: okpPkcs8(name) },
      { format: "components", components: components(okpPublicJwk(name)) },
      { format: "components", components: components(okpPrivateJwk(name)) },
    ] as const;
    for (const input of inputs) {
      const record = success(provider.importKey(input));
      const type = input.format === "pkcs8" || (input.format === "components" && input.components.d !== undefined)
        ? "private" : "public";
      assert.deepEqual(record.info, { family: "OKP", type, namedCurve: name });
      assert.deepEqual(Object.keys(record.handle), []);
      assert.deepEqual(success(provider.exportComponents(record.handle)), components(type === "private" ? okpPrivateJwk(name) : okpPublicJwk(name)));
    }
  });

  test(`native ${name} imports own bytes and exports independent exact-sized buffers`, () => {
    const provider = new NodeCryptoProvider();
    const input = components(okpPrivateJwk(name));
    const privateKey = success(provider.importKey({ format: "components", components: input }));
    input.d!.fill(0); input.x.fill(0);
    const raw = okpRawPublic(name);
    const offset = new Uint8Array(40);
    offset.set(raw, 3);
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes: offset.subarray(3, 35) }));
    offset.fill(0);
    for (const [record, format, expected] of [[privateKey, "pkcs8", okpPkcs8(name)], [publicKey, "spki", okpSpki(name)], [publicKey, "raw", raw]] as const) {
      const first = success(provider.exportKey(record.handle, format));
      const second = success(provider.exportKey(record.handle, format));
      assertOwned(first); assertOwned(second);
      assert.deepEqual(first, expected);
      assert.notEqual(first.buffer, second.buffer);
      first.fill(0);
      assert.deepEqual(second, expected);
    }
    const first = success(provider.exportComponents(privateKey.handle));
    const second = success(provider.exportComponents(privateKey.handle));
    assert.ok(first.family === "OKP" && second.family === "OKP");
    assertOwned(first.x); assertOwned(first.d!);
    assert.notEqual(first.x.buffer, first.d!.buffer);
    assert.notEqual(first.x.buffer, second.x.buffer);
    assert.notEqual(first.d!.buffer, second.d!.buffer);
    first.x.fill(0); first.d!.fill(0);
    assert.deepEqual(second, components(okpPrivateJwk(name)));
    assert.deepEqual(provider.exportKey(privateKey.handle, "raw"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(privateKey.handle, "spki"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(publicKey.handle, "pkcs8"), { failure: "operation" });
  });

  test(`native ${name} retains arbitrary public encodings without mathematical import validation`, () => {
    const provider = new NodeCryptoProvider();
    const identity = new Uint8Array(32); identity[0] = 1;
    const noncanonical = new Uint8Array(32).fill(0xff); noncanonical[0] = 0xed; noncanonical[31] = 0x7f;
    for (const bytes of [new Uint8Array(32), identity, new Uint8Array(32).fill(0xff), noncanonical]) {
      const key = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes }));
      assert.deepEqual(success(provider.exportKey(key.handle, "raw")), bytes);
      const data = success(provider.exportComponents(key.handle));
      assert.ok(data.family === "OKP");
      assert.deepEqual(data.x, bytes);
      const spki = success(provider.exportKey(key.handle, "spki"));
      const roundTrip = success(provider.importKey({ format: "spki", bytes: spki }));
      assert.deepEqual(success(provider.exportKey(roundTrip.handle, "raw")), bytes);
      const componentKey = success(provider.importKey({ format: "components", components: data }));
      assert.deepEqual(success(provider.exportKey(componentKey.handle, "raw")), bytes);
    }
  });

  test(`native ${name} derives the actual public point from the original private seed`, () => {
    const provider = new NodeCryptoProvider();
    const jwk = okpPrivateJwk(name);
    const unrelated = new Uint8Array(32).fill(0xaa);
    const native = createPrivateKey({ format: "jwk", key: { ...jwk, x: Buffer.from(unrelated).toString("base64url") } });
    assert.equal(native.export({ format: "jwk" }).x, jwk.x, "Node derives x from d even when supplied x differs");
    assert.equal(createPublicKey(native).export({ format: "jwk" }).x, jwk.x);
    const input = { ...components(jwk), x: unrelated };
    const record = success(provider.importKey({ format: "components", components: input }));
    assert.deepEqual(success(provider.exportComponents(record.handle)), components(jwk));
  });

  test(`native ${name} generation returns usable actual public/private records`, () => {
    const provider = new NodeCryptoProvider();
    const pair = success(provider.generateKeyPair({ family: "OKP", namedCurve: name }));
    assert.deepEqual(pair.privateKey.info, { family: "OKP", type: "private", namedCurve: name });
    assert.deepEqual(pair.publicKey.info, { family: "OKP", type: "public", namedCurve: name });
    const privateComponents = success(provider.exportComponents(pair.privateKey.handle));
    const publicComponents = success(provider.exportComponents(pair.publicKey.handle));
    assert.ok(privateComponents.family === "OKP" && publicComponents.family === "OKP");
    assert.equal(privateComponents.d!.byteLength, 32);
    assert.equal(publicComponents.x.byteLength, 32);
    assert.equal(publicComponents.d, undefined);
    assert.deepEqual(privateComponents.x, publicComponents.x);
    if (name === "Ed25519") {
      const signature = success(provider.sign({ name }, pair.privateKey.handle, new Uint8Array(0)));
      assert.ok(signature.kind === "bytes");
      assert.equal(signature.bytes.byteLength, 64);
      assert.equal(provider.verify({ name }, pair.publicKey.handle, signature, new Uint8Array(0)), true);
    } else {
      const secret = success(provider.derive({ name, publicKey: pair.publicKey.handle }, pair.privateKey.handle));
      assert.equal(secret.byteLength, 32);
      assertOwned(secret);
    }
  });

  test(`native ${name} rejects wrong-sized encoded keys as failure values`, () => {
    const provider = new NodeCryptoProvider();
    for (const width of [0, 31, 33, 64]) {
      assert.deepEqual(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes: new Uint8Array(width) }), { failure: "invalid-key" });
      assert.deepEqual(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: name, x: okpRawPublic(name), d: new Uint8Array(width) } }), { failure: "invalid-key" });
    }
    const zero = new Uint8Array(32);
    const validSeed = success(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: name, x: zero, d: zero } }));
    const actual = success(provider.exportComponents(validSeed.handle));
    assert.ok(actual.family === "OKP");
    assert.deepEqual(actual.d, zero, "all seed octets are admissible; seeds are not EC scalars");
  });
}

for (let index = 0; index < 5; index++) {
  test(`native Ed25519 matches RFC 8032 §7.1 vector ${index + 1} exactly`, () => {
    const provider = new NodeCryptoProvider();
    const privateKey = success(provider.importKey({ format: "components", components: components(ed25519PrivateJwk(index)) }));
    const publicKey = success(provider.importKey({ format: "components", components: components(ed25519PublicJwk(index)) }));
    const message = ed25519Message(index);
    const signature = success(provider.sign({ name: "Ed25519" }, privateKey.handle, message));
    assert.ok(signature.kind === "bytes");
    assertOwned(signature.bytes);
    assert.deepEqual(signature.bytes, ed25519Signature(index));
    assert.equal(provider.verify({ name: "Ed25519" }, publicKey.handle, signature, message), true);
    assert.equal(provider.verify({ name: "Ed25519" }, publicKey.handle, signature, new Uint8Array([...message, 0])), false);
    signature.bytes[0]! ^= 1;
    assert.equal(provider.verify({ name: "Ed25519" }, publicKey.handle, signature, message), false);
    assert.deepEqual(success(provider.sign({ name: "Ed25519" }, privateKey.handle, message)), { kind: "bytes", bytes: ed25519Signature(index) });
  });
}

test("native Ed25519 rejects malformed, small-order and noncanonical verification inputs", () => {
  const provider = new NodeCryptoProvider();
  const key = imported(provider, "Ed25519", "public");
  const message = ed25519Message();
  for (const width of [0, 32, 63, 65, 128]) {
    assert.equal(provider.verify({ name: "Ed25519" }, key.handle, { kind: "bytes", bytes: new Uint8Array(width) }, message), false);
  }
  const identity = new Uint8Array(32); identity[0] = 1;
  const noncanonical = new Uint8Array(32).fill(0xff); noncanonical[0] = 0xed; noncanonical[31] = 0x7f;
  for (const point of [new Uint8Array(32), identity, noncanonical, new Uint8Array(32).fill(0xff)]) {
    const signature = ed25519Signature(); signature.set(point, 0);
    assert.equal(provider.verify({ name: "Ed25519" }, key.handle, { kind: "bytes", bytes: signature }, message), false);
    const invalidKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "Ed25519", bytes: point }));
    assert.equal(provider.verify({ name: "Ed25519" }, invalidKey.handle, { kind: "bytes", bytes: ed25519Signature() }, message), false);
  }
  const identityKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "Ed25519", bytes: identity }));
  const forgery = new Uint8Array(64); forgery.set(identity);
  assert.equal(provider.verify({ name: "Ed25519" }, identityKey.handle, { kind: "bytes", bytes: forgery }, message), false);
  const outOfRange = ed25519Signature();
  outOfRange.set(Buffer.from("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010", "hex"), 32);
  assert.equal(provider.verify({ name: "Ed25519" }, key.handle, { kind: "bytes", bytes: outOfRange }, message), false);
});

test("native X25519 returns the RFC 7748 §6.1 shared secret from both directions", () => {
  const provider = new NodeCryptoProvider();
  for (const [from, to] of [["alice", "bob"], ["bob", "alice"]] as const) {
    const privateKey = success(provider.importKey({ format: "components", components: components(x25519PrivateJwk(from)) }));
    const publicKey = success(provider.importKey({ format: "components", components: components(x25519PublicJwk(to)) }));
    const first = success(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle));
    const second = success(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle));
    assertOwned(first); assertOwned(second);
    assert.deepEqual(first, x25519Secret());
    assert.notEqual(first.buffer, second.buffer);
    first.fill(0);
    assert.deepEqual(second, x25519Secret());
  }
});

for (const index of [0, 1] as const) {
  test(`native X25519 matches RFC 7748 §5.2 scalar-function vector ${index + 1}`, () => {
    const provider = new NodeCryptoProvider();
    const vector = x25519ScalarVector(index);
    const privateKey = success(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: "X25519", d: vector.scalar, x: new Uint8Array(32) } }));
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X25519", bytes: vector.publicKey }));
    assert.deepEqual(success(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle)), vector.secret);
  });
}

test("native X25519 masks input-coordinate top bits and reduces noncanonical u during agreement only", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = imported(provider, "X25519", "private");
  const u = new Uint8Array(32); u[0] = 9;
  const highBit = u.slice(); highBit[31] = 0x80;
  const noncanonical = new Uint8Array(32).fill(0xff); noncanonical[0] = 0xf6; noncanonical[31] = 0x7f;
  for (const point of [u, highBit, noncanonical]) {
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X25519", bytes: point }));
    assert.deepEqual(success(provider.exportKey(publicKey.handle, "raw")), point);
    assert.deepEqual(success(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle)), okpRawPublic("X25519"));
  }
});

test("native X25519 retains unclamped seeds while deriving equal public points from equivalent scalars", () => {
  const provider = new NodeCryptoProvider();
  const original = components(x25519PrivateJwk());
  const equivalent = original.d!.slice(); equivalent[0]! ^= 7; equivalent[31]! ^= 0xc0;
  const key = success(provider.importKey({ format: "components", components: { ...original, d: equivalent } }));
  const actual = success(provider.exportComponents(key.handle));
  assert.ok(actual.family === "OKP");
  assert.deepEqual(actual.x, original.x);
  assert.deepEqual(actual.d, equivalent);
  assert.notDeepEqual(actual.d, original.d);
});

test("native X25519 represents low-order agreement failure as an operation value", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = imported(provider, "X25519", "private");
  for (const first of [0, 1]) {
    const point = new Uint8Array(32); point[0] = first;
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X25519", bytes: point }));
    assert.deepEqual(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle), { failure: "operation" });
  }
});

test("native OKP rejects unknown handles, wrong families and wrong key kinds without throwing", () => {
  const provider = new NodeCryptoProvider();
  const unknown = {} as CryptoKeyHandle;
  const edPublic = imported(provider, "Ed25519", "public");
  const edPrivate = imported(provider, "Ed25519", "private");
  const xPublic = imported(provider, "X25519", "public");
  const xPrivate = imported(provider, "X25519", "private");
  const data = new Uint8Array(0);
  for (const key of [unknown, edPublic.handle, xPrivate.handle]) {
    assert.deepEqual(provider.sign({ name: "Ed25519" }, key, data), { failure: "invalid-key" });
  }
  for (const key of [unknown, edPrivate.handle, xPublic.handle]) {
    assert.equal(provider.verify({ name: "Ed25519" }, key, { kind: "bytes", bytes: ed25519Signature() }, data), false);
  }
  assert.equal(provider.verify({ name: "Ed25519" }, edPublic.handle, { kind: "ecdsa", r: new Uint8Array(32), s: new Uint8Array(32) }, data), false);
  for (const [privateKey, publicKey] of [[unknown, xPublic.handle], [xPrivate.handle, unknown], [xPublic.handle, xPrivate.handle], [edPrivate.handle, xPublic.handle], [xPrivate.handle, edPublic.handle]] as const) {
    assert.deepEqual(provider.derive({ name: "X25519", publicKey }, privateKey), { failure: "invalid-key" });
  }
  assert.deepEqual(provider.exportKey(unknown, "raw"), { failure: "invalid-key" });
  assert.deepEqual(provider.exportComponents(unknown), { failure: "invalid-key" });
});
