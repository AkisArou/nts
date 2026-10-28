// Native primitive controls. Published answers: RFC 6979 §§A.2.5–A.2.7
// and RFC 5903 §§8.1–8.3; no host Web Crypto implementation is called.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import test from "node:test";
import type {
  CryptoEcComponents,
  CryptoEcdsaSignature,
  CryptoFailure,
  CryptoKeyHandle,
  CryptoKeyRecord,
  CryptoNamedCurve,
} from "../src/provider/crypto.ts";
import {
  ecdhPrivateJwk,
  ecdhPublicJwk,
  ecdhSecret,
  ecdsaMessage,
  ecdsaSignature,
  ecOrder,
  ecPkcs8,
  ecPrivateJwk,
  ecPublicJwk,
  ecRawPublic,
  ecSpki,
} from "./ec-fixtures.ts";
import type { EcFixturePrivateJwk, EcFixturePublicJwk } from "./ec-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function components(jwk: EcFixturePrivateJwk | EcFixturePublicJwk): CryptoEcComponents {
  const result: CryptoEcComponents = {
    family: "EC", namedCurve: jwk.crv,
    x: new Uint8Array(Buffer.from(jwk.x, "base64url")),
    y: new Uint8Array(Buffer.from(jwk.y, "base64url")),
  };
  return "d" in jwk ? { ...result, d: new Uint8Array(Buffer.from(jwk.d, "base64url")) } : result;
}

function imported(provider: NodeCryptoProvider, curve: CryptoNamedCurve, type: "public" | "private"): CryptoKeyRecord {
  return success(provider.importKey({
    format: type === "public" ? "spki" : "pkcs8", bytes: type === "public" ? ecSpki(curve) : ecPkcs8(curve),
  }));
}

function signatureParts(bytes: Uint8Array): CryptoEcdsaSignature {
  const width = bytes.byteLength / 2;
  return { kind: "ecdsa", r: bytes.subarray(0, width), s: bytes.subarray(width) };
}

function fixedSignature(signature: CryptoEcdsaSignature, width: number): Uint8Array {
  const bytes = new Uint8Array(width * 2);
  bytes.set(signature.r, width - signature.r.byteLength);
  bytes.set(signature.s, 2 * width - signature.s.byteLength);
  return bytes;
}

function assertOwned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.byteLength, bytes.buffer.byteLength);
}

for (const curve of ["P-256", "P-384", "P-521"] as const) {
  test(`native EC ${curve} imports raw, SPKI, PKCS8 and components with actual metadata`, () => {
    const provider = new NodeCryptoProvider();
    const publicInputs = [
      { format: "raw", family: "EC", namedCurve: curve, bytes: ecRawPublic(curve) },
      { format: "spki", bytes: ecSpki(curve) },
      { format: "components", components: components(ecPublicJwk(curve)) },
    ] as const;
    const privateInputs = [
      { format: "pkcs8", bytes: ecPkcs8(curve) },
      { format: "components", components: components(ecPrivateJwk(curve)) },
    ] as const;
    for (const input of [...publicInputs, ...privateInputs]) {
      const key = success(provider.importKey(input));
      const type = input.format === "pkcs8" || (input.format === "components" && input.components.d !== undefined)
        ? "private" : "public";
      assert.deepEqual(key.info, { family: "EC", type, namedCurve: curve });
      assert.deepEqual(Object.keys(key.handle), []);
      assert.deepEqual(success(provider.exportComponents(key.handle)), components(type === "private" ? ecPrivateJwk(curve) : ecPublicJwk(curve)));
    }
  });

  test(`native EC ${curve} imports own material and exports exact independent buffers`, () => {
    const provider = new NodeCryptoProvider();
    const input = components(ecPrivateJwk(curve));
    const privateKey = success(provider.importKey({ format: "components", components: input }));
    input.x.fill(0);
    input.y.fill(0);
    input.d!.fill(0);
    const first = success(provider.exportComponents(privateKey.handle));
    const second = success(provider.exportComponents(privateKey.handle));
    assert.deepEqual(first, components(ecPrivateJwk(curve)));
    assert.ok(first.family === "EC" && second.family === "EC");
    for (const member of ["x", "y", "d"] as const) {
      assertOwned(first[member]!);
      assert.notEqual(first[member]!.buffer, second[member]!.buffer);
      first[member]!.fill(0);
    }
    assert.deepEqual(second, components(ecPrivateJwk(curve)));
    const raw = ecRawPublic(curve);
    const offset = new Uint8Array(raw.byteLength + 8);
    offset.set(raw, 3);
    const publicKey = success(provider.importKey({
      format: "raw", family: "EC", namedCurve: curve, bytes: offset.subarray(3, raw.byteLength + 3),
    }));
    offset.fill(0);
    for (const [record, format, expected] of [
      [privateKey, "pkcs8", ecPkcs8(curve)],
      [publicKey, "spki", ecSpki(curve)],
      [publicKey, "raw", raw],
    ] as const) {
      const output = success(provider.exportKey(record.handle, format));
      const repeat = success(provider.exportKey(record.handle, format));
      assertOwned(output);
      assertOwned(repeat);
      assert.deepEqual(output, expected);
      assert.notEqual(output.buffer, repeat.buffer);
      output.fill(0);
      assert.deepEqual(repeat, expected);
    }
    assert.deepEqual(provider.exportKey(privateKey.handle, "raw"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(privateKey.handle, "spki"), { failure: "operation" });
    assert.deepEqual(provider.exportKey(publicKey.handle, "pkcs8"), { failure: "operation" });
  });

  test(`native EC ${curve} regenerates the private key's actual point for shared consistency checks`, () => {
    const provider = new NodeCryptoProvider();
    const original = ecPrivateJwk(curve);
    const unrelated = ecdhPublicJwk(curve, "initiator");
    const mismatched = { ...original, x: unrelated.x, y: unrelated.y };
    // This control establishes why native import success/export alone cannot
    // validate the supplied public point: Node preserves this inconsistent pair.
    const native = createPrivateKey({ key: mismatched, format: "jwk" });
    assert.equal(createPublicKey(native).export({ format: "jwk" }).x, unrelated.x);
    for (const input of [
      { format: "components", components: components(mismatched) },
      { format: "pkcs8", bytes: native.export({ format: "der", type: "pkcs8" }) },
    ] as const) {
      const key = success(provider.importKey(input));
      // The shared import algorithm compares these actual components with its
      // parsed originals, and reports DataError when they differ.
      assert.deepEqual(success(provider.exportComponents(key.handle)), components(original));
    }
  });

  test(`native EC ${curve} validates mathematical public points and private scalar bounds`, () => {
    const provider = new NodeCryptoProvider();
    const valid = components(ecPrivateJwk(curve));
    for (const d of [new Uint8Array(valid.d!.byteLength), ecOrder(curve)]) {
      assert.deepEqual(provider.importKey({ format: "components", components: { ...valid, d } }), { failure: "invalid-key" });
    }
    const zeroPoint = new Uint8Array(1 + 2 * valid.x.byteLength);
    zeroPoint[0] = 4;
    assert.deepEqual(provider.importKey({ format: "raw", family: "EC", namedCurve: curve, bytes: zeroPoint }), { failure: "invalid-key" });
    assert.deepEqual(provider.importKey({
      format: "components", components: { family: "EC", namedCurve: curve, x: valid.x, y: new Uint8Array(valid.y.byteLength) },
    }), { failure: "invalid-key" });
    const invalidPoint = ecSpki(curve);
    invalidPoint[invalidPoint.length - 1] = invalidPoint[invalidPoint.length - 1]! ^ 1;
    assert.deepEqual(provider.importKey({ format: "spki", bytes: invalidPoint }), { failure: "invalid-key" });
  });

  test(`native EC ${curve} generation produces independent usable key handles`, () => {
    const provider = new NodeCryptoProvider();
    const pair = success(provider.generateKeyPair({ family: "EC", namedCurve: curve }));
    assert.deepEqual(pair.publicKey.info, { family: "EC", type: "public", namedCurve: curve });
    assert.deepEqual(pair.privateKey.info, { family: "EC", type: "private", namedCurve: curve });
    assert.notEqual(pair.publicKey.handle, pair.privateKey.handle);
    const publicParts = success(provider.exportComponents(pair.publicKey.handle));
    const privateParts = success(provider.exportComponents(pair.privateKey.handle));
    assert.ok(publicParts.family === "EC" && privateParts.family === "EC");
    assert.deepEqual(publicParts.x, privateParts.x);
    assert.deepEqual(publicParts.y, privateParts.y);
    assert.notEqual(publicParts.x.buffer, privateParts.x.buffer);
    const signature = success(provider.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey.handle, ecdsaMessage()));
    assert.ok(signature.kind === "ecdsa");
    assert.equal(provider.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey.handle,
      signatureParts(fixedSignature(signature, publicParts.x.byteLength)), ecdsaMessage()), true);
  });

  for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
    test(`native ECDSA ${curve}/${hash} verifies RFC 6979 and signs through the selected hash`, () => {
      const provider = new NodeCryptoProvider();
      const publicKey = imported(provider, curve, "public");
      const privateKey = imported(provider, curve, "private");
      const parameters = { name: "ECDSA", hash } as const;
      const answer = signatureParts(ecdsaSignature(curve, hash));
      assert.equal(provider.verify(parameters, publicKey.handle, answer, ecdsaMessage()), true);
      assert.equal(provider.verify(parameters, publicKey.handle, answer, new Uint8Array()), false);
      assert.equal(provider.verify({ name: "ECDSA", hash: hash === "SHA-256" ? "SHA-384" : "SHA-256" },
        publicKey.handle, answer, ecdsaMessage()), false);
      answer.s[answer.s.length - 1] = answer.s[answer.s.length - 1]! ^ 1;
      assert.equal(provider.verify(parameters, publicKey.handle, answer, ecdsaMessage()), false);
      const generated = success(provider.sign(parameters, privateKey.handle, ecdsaMessage()));
      assert.ok(generated.kind === "ecdsa");
      const width = answer.r.byteLength;
      for (const part of [generated.r, generated.s]) {
        assertOwned(part);
        assert.ok(part.byteLength > 0 && part.byteLength <= width);
        assert.notEqual(part[0], 0, "native signature integers are minimal and nonzero");
      }
      assert.notEqual(generated.r.buffer, generated.s.buffer);
      const p1363 = fixedSignature(generated, width);
      assert.equal(verify(hash.toLowerCase().replace("-", ""), ecdsaMessage(), {
        key: createPublicKey({ key: Buffer.from(ecSpki(curve)), format: "der", type: "spki" }), dsaEncoding: "ieee-p1363",
      }, p1363), true);
      assert.equal(provider.verify(parameters, publicKey.handle, signatureParts(p1363), ecdsaMessage()), true);
    });
  }

  test(`native ECDSA ${curve} returns false for invalid scalar encodings and signature kinds`, () => {
    const provider = new NodeCryptoProvider();
    const publicKey = imported(provider, curve, "public");
    const parameters = { name: "ECDSA", hash: "SHA-256" } as const;
    const valid = signatureParts(ecdsaSignature(curve));
    for (const r of [new Uint8Array(valid.r.byteLength), ecOrder(curve), valid.r.subarray(1), new Uint8Array(valid.r.byteLength + 1)]) {
      assert.equal(provider.verify(parameters, publicKey.handle, { kind: "ecdsa", r, s: valid.s }, ecdsaMessage()), false);
    }
    assert.equal(provider.verify(parameters, publicKey.handle, { kind: "ecdsa", r: valid.r, s: ecOrder(curve) }, ecdsaMessage()), false);
    assert.equal(provider.verify(parameters, publicKey.handle, { kind: "bytes", bytes: ecdsaSignature(curve) }, ecdsaMessage()), false);
    assert.equal(provider.verify(parameters, imported(provider, curve, "private").handle, valid, ecdsaMessage()), false);
    assert.deepEqual(provider.sign(parameters, publicKey.handle, ecdsaMessage()), { failure: "invalid-key" });
  });

  test(`native ECDH ${curve} returns RFC 5903's full-width shared secret in both directions`, () => {
    const first = new NodeCryptoProvider();
    const second = new NodeCryptoProvider();
    const initiator = success(first.importKey({ format: "components", components: components(ecdhPrivateJwk(curve, "initiator")) }));
    const responder = success(second.importKey({ format: "components", components: components(ecdhPrivateJwk(curve, "responder")) }));
    const initiatorPublic = success(first.importKey({ format: "components", components: components(ecdhPublicJwk(curve, "initiator")) }));
    const responderPublic = success(second.importKey({ format: "components", components: components(ecdhPublicJwk(curve, "responder")) }));
    const forward = success(first.derive({ name: "ECDH", publicKey: responderPublic.handle }, initiator.handle));
    const reverse = success(second.derive({ name: "ECDH", publicKey: initiatorPublic.handle }, responder.handle));
    assert.deepEqual(forward, ecdhSecret(curve));
    assert.deepEqual(reverse, ecdhSecret(curve));
    assertOwned(forward);
    assertOwned(reverse);
    assert.notEqual(forward.buffer, reverse.buffer);
    forward.fill(0);
    assert.deepEqual(reverse, ecdhSecret(curve));
    assert.deepEqual(success(first.derive({ name: "ECDH", publicKey: responderPublic.handle }, initiator.handle)), ecdhSecret(curve));
    if (curve === "P-521") assert.equal(reverse.byteLength, 66);
  });
}

test("native EC foreign handles and incompatible agreements return failure values", () => {
  const provider = new NodeCryptoProvider();
  const foreign = {} as CryptoKeyHandle;
  const publicKey = imported(provider, "P-256", "public");
  const privateKey = imported(provider, "P-256", "private");
  const differentCurve = imported(provider, "P-384", "public");
  const secret = success(provider.importKey({ format: "raw", family: "secret", bytes: new Uint8Array(16) }));
  assert.deepEqual(provider.exportKey(foreign, "raw"), { failure: "invalid-key" });
  assert.deepEqual(provider.exportComponents(foreign), { failure: "invalid-key" });
  assert.deepEqual(provider.sign({ name: "ECDSA", hash: "SHA-256" }, foreign, ecdsaMessage()), { failure: "invalid-key" });
  assert.equal(provider.verify({ name: "ECDSA", hash: "SHA-256" }, foreign, signatureParts(ecdsaSignature()), ecdsaMessage()), false);
  for (const [base, peer] of [[foreign, publicKey.handle], [privateKey.handle, foreign], [publicKey.handle, publicKey.handle],
    [privateKey.handle, privateKey.handle], [secret.handle, publicKey.handle], [privateKey.handle, secret.handle]]) {
    assert.deepEqual(provider.derive({ name: "ECDH", publicKey: peer! }, base!), { failure: "invalid-key" });
  }
  assert.deepEqual(provider.derive({ name: "ECDH", publicKey: differentCurve.handle }, privateKey.handle), { failure: "operation" });
  assert.deepEqual(provider.derive({ name: "X25519", publicKey: publicKey.handle }, privateKey.handle), { failure: "invalid-key" });
  assert.deepEqual(provider.derive({ name: "X448", publicKey: publicKey.handle }, privateKey.handle), { failure: "operation" });
  assert.deepEqual(provider.generateKeyPair({ family: "EC", namedCurve: "unsupported" as CryptoNamedCurve }), { failure: "operation" });
});
