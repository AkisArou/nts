// Specification controls: Web Cryptography §9, §§20.9.4, 21.4.4, 22.4.4;
// X.690 DER; RFC 3447 A.1; RFC 5208 §5; RFC 5280 AlgorithmIdentifier/SPKI.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { parseRsaDer } from "../src/crypto/der.ts";
import { rsaPkcs8, rsaPrivateJwk, rsaSpki } from "./rsa-fixtures.ts";

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}
function bytes(...values: number[]): Uint8Array { return new Uint8Array(values); }
function der(tag: number, ...contents: readonly Uint8Array[]): Uint8Array {
  const value = concat(...contents);
  const length = value.length;
  const encodedLength = length < 128 ? bytes(length)
    : length < 256 ? bytes(0x81, length) : bytes(0x82, length >>> 8, length & 255);
  return concat(bytes(tag), encodedLength, value);
}
function integer(...value: number[]): Uint8Array { return der(0x02, bytes(...value)); }
const oid = der(0x06, bytes(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1));
const nullValue = bytes(0x05, 0);
function algorithm(parameters: Uint8Array = nullValue): Uint8Array { return der(0x30, oid, parameters); }
function publicKey(n = integer(55), e = integer(3)): Uint8Array { return der(0x30, n, e); }
function privateKey(version = integer(0), rest = bytes()): Uint8Array {
  return der(0x30, version, integer(55), integer(3), integer(7), integer(5), integer(11), integer(3), integer(7), integer(1), rest);
}
function spki(key = publicKey(), parameters = nullValue, unused = 0): Uint8Array {
  return der(0x30, algorithm(parameters), der(0x03, bytes(unused), key));
}
function pkcs8(key = privateKey(), parameters = nullValue, version = integer(0), attributes = bytes()): Uint8Array {
  return der(0x30, version, algorithm(parameters), der(0x04, key), attributes);
}
function dataError(error: unknown): boolean { return error instanceof DOMException && error.name === "DataError"; }

for (const format of ["spki", "pkcs8"] as const) {
  test(format + " parser accepts canonical DER and returns borrowed minimal unsigned components", () => {
    const encoded = format === "spki" ? rsaSpki() : rsaPkcs8();
    const key = parseRsaDer(format, encoded);
    const jwk = rsaPrivateJwk();
    assert.equal(Buffer.from(key.n).toString("base64url"), jwk.n);
    assert.equal(Buffer.from(key.e).toString("base64url"), jwk.e);
    assert.equal(key.n.buffer, encoded.buffer);
    assert.equal(key.e.buffer, encoded.buffer);
    assert.equal(key.n[0]! >= 128, true, "DER sign octet is omitted from unsigned components");
    if (format === "pkcs8") {
      assert.equal(Buffer.from(key.d!).toString("base64url"), jwk.d);
      assert.equal(Buffer.from(key.p!).toString("base64url"), jwk.p);
      assert.equal(Buffer.from(key.q!).toString("base64url"), jwk.q);
      assert.equal(Buffer.from(key.dp!).toString("base64url"), jwk.dp);
      assert.equal(Buffer.from(key.dq!).toString("base64url"), jwk.dq);
      assert.equal(Buffer.from(key.qi!).toString("base64url"), jwk.qi);
      assert.equal(key.oth, undefined);
    }
  });

  test(format + " imports allow absent AlgorithmIdentifier parameters while exports require NULL", () => {
    const encoded = format === "spki" ? spki(publicKey(), bytes()) : pkcs8(privateKey(), bytes());
    assert.equal(parseRsaDer(format, encoded).n[0], 55);
    assert.throws(() => parseRsaDer(format, encoded, true), dataError);
    for (const parameters of [integer(0), der(0x05, bytes(0)), concat(nullValue, nullValue)]) {
      const invalid = format === "spki" ? spki(publicKey(), parameters) : pkcs8(privateKey(), parameters);
      assert.throws(() => parseRsaDer(format, invalid), dataError);
    }
  });

  test(format + " rejects every truncation and trailing outer bytes", () => {
    const original = format === "spki" ? spki() : pkcs8();
    for (let length = 0; length < original.length; length++) {
      assert.throws(() => parseRsaDer(format, original.subarray(0, length)), dataError, "length=" + length);
    }
    assert.throws(() => parseRsaDer(format, concat(original, bytes(0))), dataError);
    assert.throws(() => parseRsaDer(format, concat(original, nullValue)), dataError);
  });

  test(format + " rejects BER lengths, nonminimal DER lengths and length overflow", () => {
    const original = format === "spki" ? spki() : pkcs8();
    const content = original.subarray(2);
    for (const encoded of [
      concat(bytes(0x30, 0x80), content, bytes(0, 0)),
      concat(bytes(0x30, 0x81, content.length), content),
      concat(bytes(0x30, 0x82, 0, content.length), content),
      concat(bytes(0x30, 0x81, 255), content),
      concat(bytes(0x30, 0x87, 1, 0, 0, 0, 0, 0, 0), content),
    ]) assert.throws(() => parseRsaDer(format, encoded), dataError);
  });

  test(format + " rejects non-rsaEncryption algorithm identifiers and malformed envelopes", () => {
    const good = format === "spki" ? spki() : pkcs8();
    const altered = good.slice();
    const oidAt = Buffer.from(altered).indexOf(Buffer.from(oid));
    assert.ok(oidAt >= 0);
    altered[oidAt + oid.length - 1] = 10; // id-RSASSA-PSS is not rsaEncryption.
    assert.throws(() => parseRsaDer(format, altered), dataError);
    const outerTag = good.slice(); outerTag[0] = 0x31;
    assert.throws(() => parseRsaDer(format, outerTag), dataError);
    const missingAlgorithm = format === "spki"
      ? der(0x30, der(0x03, bytes(0), publicKey()))
      : der(0x30, integer(0), der(0x04, privateKey()));
    assert.throws(() => parseRsaDer(format, missingAlgorithm), dataError);
  });
}

test("SPKI requires a primitive byte-aligned BIT STRING containing exactly one RSAPublicKey", () => {
  for (const unused of [1, 7, 8, 255]) assert.throws(() => parseRsaDer("spki", spki(publicKey(), nullValue, unused)), dataError);
  for (const encoded of [
    der(0x30, algorithm(), der(0x03)),
    der(0x30, algorithm(), der(0x23, der(0x03, bytes(0), publicKey()))),
    spki(concat(publicKey(), nullValue)),
    der(0x30, algorithm(), der(0x03, bytes(0), publicKey()), nullValue),
    spki(der(0x30, integer(55), integer(3), integer(1))),
    spki(der(0x30, integer(55))),
  ]) assert.throws(() => parseRsaDer("spki", encoded), dataError);
});

test("RSA integers must be positive and use minimal signed DER encodings", () => {
  for (const invalid of [integer(), integer(0), integer(0xff), integer(0, 55), integer(0, 0, 0x80), der(0x22, integer(55))]) {
    assert.throws(() => parseRsaDer("spki", spki(publicKey(invalid))), dataError);
    assert.throws(() => parseRsaDer("spki", spki(publicKey(integer(55), invalid))), dataError);
    const privateEncoded = der(0x30, integer(0), integer(55), integer(3), invalid, integer(5), integer(11), integer(3), integer(7), integer(1));
    assert.throws(() => parseRsaDer("pkcs8", pkcs8(privateEncoded)), dataError);
  }
  assert.deepEqual(parseRsaDer("spki", spki(publicKey(integer(0, 0x80)))).n, bytes(0x80));
});

test("PKCS8 requires version zero and an exact primitive OCTET STRING private key", () => {
  for (const version of [integer(1), integer(2), integer(0, 0), der(0x05)]) {
    assert.throws(() => parseRsaDer("pkcs8", pkcs8(privateKey(), nullValue, version)), dataError);
  }
  for (const encoded of [
    pkcs8(concat(privateKey(), bytes(0))),
    der(0x30, integer(0), algorithm(), der(0x24, der(0x04, privateKey()))),
    pkcs8(der(0x30, integer(0), integer(55), integer(3))),
    pkcs8(privateKey(integer(2))),
    pkcs8(privateKey(integer(0), integer(1))),
    pkcs8(privateKey(), nullValue, integer(0), der(0xa1)),
  ]) assert.throws(() => parseRsaDer("pkcs8", encoded), dataError);
});

test("PKCS1 multi-prime version and OtherPrimeInfos presence must agree", () => {
  const others = der(0x30, der(0x30, integer(7), integer(5), integer(1)));
  const components = parseRsaDer("pkcs8", pkcs8(privateKey(integer(1), others)));
  assert.deepEqual(components.oth, [{ r: bytes(7), d: bytes(5), t: bytes(1) }]);
  for (const key of [
    privateKey(integer(1)),
    privateKey(integer(1), der(0x30)),
    privateKey(integer(0), others),
    privateKey(integer(1), der(0x30, der(0x30, integer(7), integer(5)))),
    privateKey(integer(1), der(0x30, der(0x30, integer(7), integer(5), integer(1), integer(1)))),
    privateKey(integer(1), concat(others, nullValue)),
  ]) assert.throws(() => parseRsaDer("pkcs8", pkcs8(key)), dataError);
});

test("PKCS8 permits well-formed optional attributes with canonical SET ordering", () => {
  const attributeOid = der(0x06, bytes(0x2a, 3));
  const attribute = der(0x30, attributeOid, der(0x31, der(0x0c, bytes(0x61))));
  assert.equal(parseRsaDer("pkcs8", pkcs8(privateKey(), nullValue, integer(0), der(0xa0, attribute))).d![0], 7);
  assert.equal(parseRsaDer("pkcs8", pkcs8(privateKey(), nullValue, integer(0), der(0xa0))).d![0], 7);
  const unknownHighTag = concat(bytes(0x9f, 0x20, 1, 5));
  const arbitrary = der(0x30, attributeOid, der(0x31, unknownHighTag));
  assert.ok(parseRsaDer("pkcs8", pkcs8(privateKey(), nullValue, integer(0), der(0xa0, arbitrary))));
  for (const attributes of [
    der(0xa0, der(0x30, attributeOid, der(0x31))),
    der(0xa0, der(0x30, attributeOid, der(0x31, nullValue), nullValue)),
    der(0xa0, der(0x30, der(0x06, bytes(0x80, 0x2a)), der(0x31, nullValue))),
    der(0xa0, der(0x30, attributeOid, der(0x31, integer(2), integer(1)))),
    der(0xa0, der(0x30, attributeOid, der(0x31, bytes(1, 1, 1)))),
    der(0xa0, der(0x30, attributeOid, der(0x31, bytes(3, 2, 1, 1)))),
    concat(der(0xa0, attribute), der(0xa0)),
  ]) assert.throws(() => parseRsaDer("pkcs8", pkcs8(privateKey(), nullValue, integer(0), attributes)), dataError);
});

test("PKCS8 open attribute values validate deep nesting without recursive stack growth", () => {
  let value = nullValue;
  for (let depth = 0; depth < 10000; depth++) value = der(0x30, value);
  const attribute = der(0x30, der(0x06, bytes(0x2a, 3)), der(0x31, value));
  const encoded = pkcs8(privateKey(), nullValue, integer(0), der(0xa0, attribute));
  assert.equal(parseRsaDer("pkcs8", encoded).d![0], 7);
});
