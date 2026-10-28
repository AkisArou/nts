// Native Ed448/X448 capability controls: RFC 8032 §7.4, RFC 7748 §§5.2/6.2,
// and RFC 8410. No host Web Crypto implementation is used.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import test from "node:test";
import type { CryptoFailure, CryptoKeyHandle, CryptoKeyRecord, CryptoOkpComponents } from "../src/provider/crypto.ts";
import {
  curve448Pkcs8, curve448PrivateJwk, curve448PublicJwk, curve448RawPublic, curve448Spki,
  ed448Context, ed448Message, ed448PrivateJwk, ed448PublicJwk, ed448Signature,
  x448PrivateJwk, x448PublicJwk, x448ScalarVector, x448Secret,
} from "./curve448-fixtures.ts";
import type { Curve448FixtureName, Curve448FixturePrivateJwk, Curve448FixturePublicJwk } from "./curve448-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function components(jwk: Curve448FixturePublicJwk | Curve448FixturePrivateJwk): CryptoOkpComponents {
  const publicComponents: CryptoOkpComponents = {
    family: "OKP", namedCurve: jwk.crv, x: new Uint8Array(Buffer.from(jwk.x, "base64url")),
  };
  return "d" in jwk ? { ...publicComponents, d: new Uint8Array(Buffer.from(jwk.d, "base64url")) } : publicComponents;
}

function imported(provider: NodeCryptoProvider, name: Curve448FixtureName, type: "public" | "private"): CryptoKeyRecord {
  return success(provider.importKey({
    format: type === "public" ? "spki" : "pkcs8", bytes: type === "public" ? curve448Spki(name) : curve448Pkcs8(name),
  }));
}

function assertOwned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.byteLength, bytes.buffer.byteLength);
}

function offsetView(bytes: Uint8Array): Uint8Array {
  const backing = new Uint8Array(bytes.byteLength + 9).fill(0xa5);
  backing.set(bytes, 3);
  return backing.subarray(3, 3 + bytes.byteLength);
}

for (const [name, width] of [["Ed448", 57], ["X448", 56]] as const) {
  test(`native ${name} imports all key formats with actual metadata and opaque handles`, () => {
    const provider = new NodeCryptoProvider();
    const inputs = [
      { format: "raw", family: "OKP", namedCurve: name, bytes: curve448RawPublic(name) },
      { format: "spki", bytes: curve448Spki(name) },
      { format: "pkcs8", bytes: curve448Pkcs8(name) },
      { format: "components", components: components(curve448PublicJwk(name)) },
      { format: "components", components: components(curve448PrivateJwk(name)) },
    ] as const;
    for (const input of inputs) {
      const record = success(provider.importKey(input));
      const type = input.format === "pkcs8" || (input.format === "components" && input.components.d !== undefined) ? "private" : "public";
      assert.deepEqual(record.info, { family: "OKP", type, namedCurve: name });
      assert.deepEqual(Object.keys(record.handle), []);
      assert.deepEqual(success(provider.exportComponents(record.handle)), components(type === "private" ? curve448PrivateJwk(name) : curve448PublicJwk(name)));
    }
  });

  test(`native ${name} owns imports and returns independent exact-sized exports`, () => {
    const provider = new NodeCryptoProvider();
    const input = components(curve448PrivateJwk(name));
    const privateKey = success(provider.importKey({ format: "components", components: input }));
    input.x.fill(0); input.d!.fill(0);
    const raw = curve448RawPublic(name);
    const view = offsetView(raw);
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes: view }));
    view.fill(0);
    for (const [record, format, expected] of [[privateKey, "pkcs8", curve448Pkcs8(name)], [publicKey, "spki", curve448Spki(name)], [publicKey, "raw", raw]] as const) {
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
    assert.deepEqual(second, components(curve448PrivateJwk(name)));
    assert.deepEqual(provider.exportKey(privateKey.handle, "raw"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(privateKey.handle, "spki"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(publicKey.handle, "pkcs8"), { failure: "operation" });
  });

  test(`native ${name} retains arbitrary public encodings without mathematical import validation`, () => {
    const provider = new NodeCryptoProvider();
    const identity = new Uint8Array(width); identity[0] = 1;
    const noncanonical = new Uint8Array(width).fill(0xff); noncanonical[28] = 0xfe;
    if (name === "Ed448") noncanonical[56] = 0;
    for (const bytes of [new Uint8Array(width), identity, new Uint8Array(width).fill(0xff), noncanonical]) {
      const record = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes }));
      assert.deepEqual(success(provider.exportKey(record.handle, "raw")), bytes);
      const exported = success(provider.exportComponents(record.handle));
      assert.ok(exported.family === "OKP");
      assert.deepEqual(exported.x, bytes);
      const spki = success(provider.exportKey(record.handle, "spki"));
      const decoded = success(provider.importKey({ format: "spki", bytes: spki }));
      assert.deepEqual(success(provider.exportKey(decoded.handle, "raw")), bytes);
      const componentKey = success(provider.importKey({ format: "components", components: exported }));
      assert.deepEqual(success(provider.exportKey(componentKey.handle, "raw")), bytes);
    }
  });

  test(`native ${name} derives actual x from the original ${width}-octet private seed`, () => {
    const provider = new NodeCryptoProvider();
    const jwk = curve448PrivateJwk(name);
    const unrelated = new Uint8Array(width).fill(0xaa);
    const native = createPrivateKey({ format: "jwk", key: { ...jwk, x: Buffer.from(unrelated).toString("base64url") } });
    assert.equal(native.export({ format: "jwk" }).x, jwk.x);
    assert.equal(createPublicKey(native).export({ format: "jwk" }).x, jwk.x);
    const record = success(provider.importKey({ format: "components", components: { ...components(jwk), x: unrelated } }));
    assert.deepEqual(success(provider.exportComponents(record.handle)), components(jwk));
  });

  test(`native ${name} generates usable public/private handles with actual widths`, () => {
    const provider = new NodeCryptoProvider();
    const pair = success(provider.generateKeyPair({ family: "OKP", namedCurve: name }));
    assert.deepEqual(pair.publicKey.info, { family: "OKP", type: "public", namedCurve: name });
    assert.deepEqual(pair.privateKey.info, { family: "OKP", type: "private", namedCurve: name });
    const publicComponents = success(provider.exportComponents(pair.publicKey.handle));
    const privateComponents = success(provider.exportComponents(pair.privateKey.handle));
    assert.ok(publicComponents.family === "OKP" && privateComponents.family === "OKP");
    assert.equal(publicComponents.x.byteLength, width);
    assert.equal(privateComponents.d!.byteLength, width);
    assert.equal(publicComponents.d, undefined);
    assert.deepEqual(publicComponents.x, privateComponents.x);
    if (name === "Ed448") {
      const context = new Uint8Array(0);
      const signature = success(provider.sign({ name, context }, pair.privateKey.handle, context));
      assert.ok(signature.kind === "bytes");
      assert.equal(signature.bytes.byteLength, 114);
      assert.equal(provider.verify({ name, context }, pair.publicKey.handle, signature, context), true);
    } else {
      const output = success(provider.derive({ name, publicKey: pair.publicKey.handle }, pair.privateKey.handle));
      assertOwned(output);
      assert.equal(output.byteLength, 56);
    }
  });

  test(`native ${name} rejects wrong widths and retains an all-zero seed`, () => {
    const provider = new NodeCryptoProvider();
    for (const length of [0, 32, width - 1, width + 1, 114]) {
      const bytes = new Uint8Array(length);
      assert.deepEqual(provider.importKey({ format: "raw", family: "OKP", namedCurve: name, bytes }), { failure: "invalid-key" });
      assert.deepEqual(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: name, x: bytes } }), { failure: "invalid-key" });
      assert.deepEqual(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: name, x: curve448RawPublic(name), d: bytes } }), { failure: "invalid-key" });
    }
    const zero = new Uint8Array(width);
    const record = success(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: name, x: zero, d: zero } }));
    const exported = success(provider.exportComponents(record.handle));
    assert.ok(exported.family === "OKP");
    assert.deepEqual(exported.d, zero);
  });
}

for (let index = 0; index < 9; index++) {
  test(`native Ed448 matches RFC 8032 §7.4 vector ${index + 1} exactly`, () => {
    const provider = new NodeCryptoProvider();
    const privateKey = success(provider.importKey({ format: "components", components: components(ed448PrivateJwk(index)) }));
    const publicKey = success(provider.importKey({ format: "components", components: components(ed448PublicJwk(index)) }));
    const message = ed448Message(index);
    const context = ed448Context(index);
    const signature = success(provider.sign({ name: "Ed448", context }, privateKey.handle, message));
    assert.ok(signature.kind === "bytes");
    assertOwned(signature.bytes);
    assert.equal(signature.bytes.byteLength, 114);
    assert.deepEqual(signature.bytes, ed448Signature(index));
    assert.equal(provider.verify({ name: "Ed448", context }, publicKey.handle, signature, message), true);
    assert.equal(provider.verify({ name: "Ed448", context }, publicKey.handle, signature, new Uint8Array([...message, 0])), false);
    assert.equal(provider.verify({ name: "Ed448", context: new Uint8Array([...context, 0]) }, publicKey.handle, signature, message), false);
    signature.bytes[0]! ^= 1;
    assert.equal(provider.verify({ name: "Ed448", context }, publicKey.handle, signature, message), false);
    assert.deepEqual(success(provider.sign({ name: "Ed448", context }, privateKey.handle, message)), { kind: "bytes", bytes: ed448Signature(index) });
  });
}

test("native Ed448 borrows exact message/context views and owns signature output", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = success(provider.importKey({ format: "components", components: components(ed448PrivateJwk(2)) }));
  const publicKey = success(provider.importKey({ format: "components", components: components(ed448PublicJwk(2)) }));
  const message = offsetView(ed448Message(2));
  const context = offsetView(ed448Context(2));
  const messageBefore = new Uint8Array(message.buffer);
  const contextBefore = new Uint8Array(context.buffer);
  const first = success(provider.sign({ name: "Ed448", context }, privateKey.handle, message));
  const second = success(provider.sign({ name: "Ed448", context }, privateKey.handle, message));
  assert.ok(first.kind === "bytes" && second.kind === "bytes");
  assertOwned(first.bytes); assertOwned(second.bytes);
  assert.deepEqual(first.bytes, ed448Signature(2));
  assert.notEqual(first.bytes.buffer, second.bytes.buffer);
  assert.notEqual(first.bytes.buffer, message.buffer);
  assert.notEqual(first.bytes.buffer, context.buffer);
  assert.equal(provider.verify({ name: "Ed448", context }, publicKey.handle, { kind: "bytes", bytes: offsetView(first.bytes) }, message), true);
  first.bytes.fill(0);
  assert.deepEqual(second.bytes, ed448Signature(2));
  assert.deepEqual(new Uint8Array(message.buffer), messageBefore);
  assert.deepEqual(new Uint8Array(context.buffer), contextBefore);
});

test("native Ed448 supports 255 context octets and returns failures beyond the limit", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = imported(provider, "Ed448", "private");
  const publicKey = imported(provider, "Ed448", "public");
  const message = new Uint8Array([1, 2, 3]);
  const context = new Uint8Array(255).fill(0xa5);
  const signature = success(provider.sign({ name: "Ed448", context }, privateKey.handle, message));
  assert.ok(signature.kind === "bytes");
  const native = createPrivateKey({ format: "jwk", key: { ...curve448PrivateJwk("Ed448") } });
  assert.deepEqual(signature.bytes, new Uint8Array(sign(null, message, { key: native, context })));
  assert.equal(provider.verify({ name: "Ed448", context }, publicKey.handle, signature, message), true);
  assert.equal(provider.verify({ name: "Ed448", context: context.subarray(0, 254) }, publicKey.handle, signature, message), false);
  const tooLong = new Uint8Array(256);
  assert.deepEqual(provider.sign({ name: "Ed448", context: tooLong }, privateKey.handle, message), { failure: "operation" });
  assert.equal(provider.verify({ name: "Ed448", context: tooLong }, publicKey.handle, signature, message), false);
});

test("native Ed448 rejects malformed encodings, small-order points and out-of-range scalars", () => {
  const provider = new NodeCryptoProvider();
  const key = imported(provider, "Ed448", "public");
  const context = new Uint8Array(0);
  const message = ed448Message();
  for (const width of [0, 56, 57, 113, 115, 228]) {
    assert.equal(provider.verify({ name: "Ed448", context }, key.handle, { kind: "bytes", bytes: new Uint8Array(width) }, message), false);
  }
  const identity = new Uint8Array(57); identity[0] = 1;
  const signedIdentity = identity.slice(); signedIdentity[56] = 0x80;
  const orderFour = new Uint8Array(57); orderFour[56] = 0x80;
  const prime = new Uint8Array(57).fill(0xff); prime[28] = 0xfe; prime[56] = 0;
  const orderTwo = prime.slice(); orderTwo[0] = 0xfe;
  const primePlusOne = new Uint8Array(57); primePlusOne.fill(0xff, 28, 56);
  for (const point of [new Uint8Array(57), identity, signedIdentity, orderFour, orderTwo, prime, primePlusOne, new Uint8Array(57).fill(0xff)]) {
    const signature = ed448Signature(); signature.set(point);
    assert.equal(provider.verify({ name: "Ed448", context }, key.handle, { kind: "bytes", bytes: signature }, message), false);
    const invalidKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "Ed448", bytes: point }));
    assert.equal(provider.verify({ name: "Ed448", context }, invalidKey.handle, { kind: "bytes", bytes: ed448Signature() }, message), false);
    const forgery = new Uint8Array(114); forgery.set(identity);
    for (const input of [message, new Uint8Array([0]), new Uint8Array([1])]) {
      assert.equal(provider.verify({ name: "Ed448", context }, invalidKey.handle, { kind: "bytes", bytes: forgery }, input), false);
    }
  }
  // RFC 8032 §5.2's group order L, encoded in 57 little-endian octets.
  const order = new Uint8Array(Buffer.from("f34458ab92c27823558fc58d72c26c219036d6ae49db4ec4e923ca7cffffffffffffffffffffffffffffffffffffffffffffffffffffff3f00", "hex"));
  assert.equal(order.byteLength, 57);
  for (const scalar of [new Uint8Array(57), order, new Uint8Array(57).fill(0xff)]) {
    const signature = ed448Signature(); signature.set(scalar, 57);
    assert.equal(provider.verify({ name: "Ed448", context }, key.handle, { kind: "bytes", bytes: signature }, message), false);
  }
  for (const mask of [1, 2, 0x40]) {
    const signature = ed448Signature(); signature[56]! |= mask;
    assert.equal(provider.verify({ name: "Ed448", context }, key.handle, { kind: "bytes", bytes: signature }, message), false);
    const point = curve448RawPublic("Ed448"); point[56]! |= mask;
    const invalidKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "Ed448", bytes: point }));
    assert.equal(provider.verify({ name: "Ed448", context }, invalidKey.handle, { kind: "bytes", bytes: ed448Signature() }, message), false);
  }
});

test("native X448 returns RFC 7748 §6.2's exact secret from both peer directions", () => {
  const provider = new NodeCryptoProvider();
  for (const [from, to] of [["alice", "bob"], ["bob", "alice"]] as const) {
    const privateKey = success(provider.importKey({ format: "components", components: components(x448PrivateJwk(from)) }));
    const publicKey = success(provider.importKey({ format: "components", components: components(x448PublicJwk(to)) }));
    const first = success(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle));
    const second = success(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle));
    assertOwned(first); assertOwned(second);
    assert.equal(first.byteLength, 56);
    assert.deepEqual(first, x448Secret());
    assert.notEqual(first.buffer, second.buffer);
    first.fill(0);
    assert.deepEqual(second, x448Secret());
  }
});

for (const index of [0, 1] as const) {
  test(`native X448 matches RFC 7748 §5.2 scalar-function vector ${index + 1}`, () => {
    const provider = new NodeCryptoProvider();
    const vector = x448ScalarVector(index);
    const privateKey = success(provider.importKey({ format: "components", components: { family: "OKP", namedCurve: "X448", d: vector.scalar, x: new Uint8Array(56) } }));
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X448", bytes: vector.publicKey }));
    assert.deepEqual(success(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle)), vector.secret);
  });
}

test("native X448 reduces noncanonical u during agreement and keeps its top input bit significant", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = imported(provider, "X448", "private");
  const base = new Uint8Array(56); base[0] = 5;
  // p+5 = 2^448 - 2^224 + 4 in the RFC's little-endian coordinate encoding.
  const noncanonical = new Uint8Array(56); noncanonical[0] = 4; noncanonical.fill(0xff, 28);
  for (const point of [base, noncanonical]) {
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X448", bytes: point }));
    assert.deepEqual(success(provider.exportKey(publicKey.handle, "raw")), point);
    assert.deepEqual(success(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle)), curve448RawPublic("X448"));
  }
  const highBit = base.slice(); highBit[55] = 0x80;
  const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X448", bytes: highBit }));
  assert.deepEqual(success(provider.exportKey(publicKey.handle, "raw")), highBit);
  assert.notDeepEqual(success(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle)), curve448RawPublic("X448"));
});

test("native X448 retains unclamped seed bits while deriving the equivalent public point", () => {
  const provider = new NodeCryptoProvider();
  const original = components(x448PrivateJwk());
  const equivalent = original.d!.slice(); equivalent[0]! ^= 3; equivalent[55]! ^= 0x80;
  const key = success(provider.importKey({ format: "components", components: { ...original, d: equivalent } }));
  const actual = success(provider.exportComponents(key.handle));
  assert.ok(actual.family === "OKP");
  assert.deepEqual(actual.x, original.x);
  assert.deepEqual(actual.d, equivalent);
  assert.notDeepEqual(actual.d, original.d);
});

test("native X448 low-order and equivalent noncanonical inputs return operation failure values", () => {
  const provider = new NodeCryptoProvider();
  const privateKey = imported(provider, "X448", "private");
  const one = new Uint8Array(56); one[0] = 1;
  const prime = new Uint8Array(56).fill(0xff); prime[28] = 0xfe;
  const primeMinusOne = prime.slice(); primeMinusOne[0] = 0xfe;
  const primePlusOne = new Uint8Array(56); primePlusOne.fill(0xff, 28);
  for (const point of [new Uint8Array(56), one, primeMinusOne, prime, primePlusOne]) {
    const publicKey = success(provider.importKey({ format: "raw", family: "OKP", namedCurve: "X448", bytes: point }));
    assert.deepEqual(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle), { failure: "operation" });
  }
});

test("native Ed448 and X448 reject unknown handles, wrong families and key kinds without throwing", () => {
  const provider = new NodeCryptoProvider();
  const unknown = {} as CryptoKeyHandle;
  const edPublic = imported(provider, "Ed448", "public");
  const edPrivate = imported(provider, "Ed448", "private");
  const xPublic = imported(provider, "X448", "public");
  const xPrivate = imported(provider, "X448", "private");
  const ed25519 = success(provider.generateKeyPair({ family: "OKP", namedCurve: "Ed25519" }));
  const x25519 = success(provider.generateKeyPair({ family: "OKP", namedCurve: "X25519" }));
  const empty = new Uint8Array(0);
  for (const key of [unknown, edPublic.handle, xPrivate.handle, ed25519.privateKey.handle]) {
    assert.deepEqual(provider.sign({ name: "Ed448", context: empty }, key, empty), { failure: "invalid-key" });
  }
  for (const key of [unknown, edPrivate.handle, xPublic.handle, ed25519.publicKey.handle]) {
    assert.equal(provider.verify({ name: "Ed448", context: empty }, key, { kind: "bytes", bytes: ed448Signature() }, empty), false);
  }
  assert.equal(provider.verify({ name: "Ed448", context: empty }, edPublic.handle, { kind: "ecdsa", r: empty, s: empty }, empty), false);
  for (const [privateKey, publicKey] of [[unknown, xPublic.handle], [xPrivate.handle, unknown], [xPublic.handle, xPrivate.handle],
    [edPrivate.handle, xPublic.handle], [xPrivate.handle, edPublic.handle], [x25519.privateKey.handle, xPublic.handle], [xPrivate.handle, x25519.publicKey.handle]] as const) {
    assert.deepEqual(provider.derive({ name: "X448", publicKey }, privateKey), { failure: "invalid-key" });
  }
});
