// Specification controls: Web Cryptography §9, §§25.3.4–5, 26.3.3–4;
// RFC 8410 §§3–4, 7; RFC 5208 §5; X.690 DER.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { parseOkpDer } from "../src/crypto/der.ts";
import { okpPkcs8, okpPrivateJwk, okpRawPublic, okpSpki } from "./okp-fixtures.ts";
import type { OkpFixtureName } from "./okp-fixtures.ts";

function bytes(...values: number[]): Uint8Array { return new Uint8Array(values); }
function concat(...parts: readonly Uint8Array[]): Uint8Array { return new Uint8Array(Buffer.concat(parts)); }
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = concat(...parts);
  const length = value.length;
  return concat(bytes(tag), length < 128 ? bytes(length) : length < 256 ? bytes(0x81, length) : bytes(0x82, length >>> 8, length & 255), value);
}
function integer(...value: number[]): Uint8Array { return der(2, bytes(...value)); }
function algorithm(name: OkpFixtureName, parameters = bytes()): Uint8Array {
  return der(0x30, der(6, bytes(0x2b, 0x65, name === "Ed25519" ? 0x70 : 0x6e)), parameters);
}
function privateBytes(name: OkpFixtureName): Uint8Array { return new Uint8Array(Buffer.from(okpPrivateJwk(name).d, "base64url")); }
function spki(name: OkpFixtureName, point = okpRawPublic(name), parameters = bytes(), unused = 0): Uint8Array {
  return der(0x30, algorithm(name, parameters), der(3, bytes(unused), point));
}
function pkcs8(name: OkpFixtureName, inner = der(4, privateBytes(name)), parameters = bytes(), version = integer(0), tail = bytes()): Uint8Array {
  return der(0x30, version, algorithm(name, parameters), der(4, inner), tail);
}
function dataError(error: unknown): boolean { return error instanceof DOMException && error.name === "DataError"; }
const names: readonly OkpFixtureName[] = ["Ed25519", "X25519"];

for (const name of names) {
  for (const format of ["spki", "pkcs8"] as const) {
    test(name + " " + format + " parses the fixed RFC key as borrowed 32-octet material", () => {
      const original = format === "spki" ? okpSpki(name) : okpPkcs8(name);
      const padded = concat(bytes(7, 8), original, bytes(9));
      const encoded = padded.subarray(2, padded.length - 1);
      const result = parseOkpDer(format, encoded);
      assert.equal(result.namedCurve, name);
      if (format === "spki") {
        assert.deepEqual(result.x, okpRawPublic(name));
        assert.equal(result.x!.buffer, padded.buffer);
        assert.equal(result.d, undefined);
      } else {
        assert.deepEqual(result.d, privateBytes(name));
        assert.equal(result.d!.buffer, padded.buffer);
        assert.equal(result.x, undefined);
      }
    });

    test(name + " " + format + " requires absent AlgorithmIdentifier parameters", () => {
      for (const parameters of [der(5), der(6, bytes(0x2b, 0x65, 0x70)), der(0x30), der(4), der(5, bytes(0))]) {
        const encoded = format === "spki" ? spki(name, okpRawPublic(name), parameters) : pkcs8(name, der(4, privateBytes(name)), parameters);
        assert.throws(() => parseOkpDer(format, encoded), dataError);
      }
      const encoded = format === "spki" ? spki(name) : pkcs8(name);
      for (const oid of [0x6f, 0x71, 0x72, 0xff]) {
        const altered = encoded.slice();
        const at = Buffer.from(altered).indexOf(Buffer.from([6, 3, 0x2b, 0x65]));
        assert.ok(at >= 0);
        altered[at + 4] = oid;
        assert.throws(() => parseOkpDer(format, altered), dataError);
      }
    });

    test(name + " " + format + " rejects trailing, truncated and nonminimal DER encodings", () => {
      const encoded = format === "spki" ? spki(name) : pkcs8(name);
      for (let length = 0; length < encoded.length; length++) assert.throws(() => parseOkpDer(format, encoded.subarray(0, length)), dataError);
      assert.throws(() => parseOkpDer(format, concat(encoded, bytes(0))), dataError);
      const body = encoded.subarray(2);
      for (const invalid of [
        concat(bytes(0x30, 0x80), body, bytes(0, 0)),
        concat(bytes(0x30, 0x81, body.length), body),
        concat(bytes(0x30, 0x82, 0, body.length), body),
        concat(bytes(0x30, 0x81, 255), body),
        concat(bytes(0x30, 0x87, 1, 0, 0, 0, 0, 0, 0), body),
        concat(bytes(0x31, body.length), body),
      ]) assert.throws(() => parseOkpDer(format, invalid), dataError);
    });
  }

  test(name + " SPKI retains every 32-octet value without point checks", () => {
    for (const point of [new Uint8Array(32), new Uint8Array(32).fill(0xff), concat(bytes(1), new Uint8Array(31))]) {
      assert.deepEqual(parseOkpDer("spki", spki(name, point)).x, point);
    }
    for (const point of [bytes(), new Uint8Array(31), new Uint8Array(33)]) {
      assert.throws(() => parseOkpDer("spki", spki(name, point)), dataError);
    }
  });

  test(name + " SPKI requires a primitive, byte-aligned BIT STRING", () => {
    for (const unused of [1, 7, 8, 255]) assert.throws(() => parseOkpDer("spki", spki(name, okpRawPublic(name), bytes(), unused)), dataError);
    for (const value of [
      der(0x30, algorithm(name), der(3)),
      der(0x30, algorithm(name), der(0x23, der(3, bytes(0), okpRawPublic(name)))),
      der(0x30, algorithm(name), der(4, okpRawPublic(name))),
      der(0x30, algorithm(name), der(3, bytes(0), okpRawPublic(name)), der(5)),
      der(0x30, der(3, bytes(0), okpRawPublic(name))),
    ]) assert.throws(() => parseOkpDer("spki", value), dataError);
  });

  test(name + " PKCS8 contains one exact primitive CurvePrivateKey octet string", () => {
    for (const seed of [new Uint8Array(32), new Uint8Array(32).fill(0xff)]) {
      assert.deepEqual(parseOkpDer("pkcs8", pkcs8(name, der(4, seed))).d, seed);
    }
    for (const seed of [bytes(), new Uint8Array(31), new Uint8Array(33), new Uint8Array(64)]) {
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, seed))), dataError);
    }
    for (const inner of [
      privateBytes(name), concat(der(4, privateBytes(name)), bytes(0)),
      concat(der(4, privateBytes(name)), der(5)), der(0x24, der(4, privateBytes(name))),
      der(0x30, integer(1), der(4, privateBytes(name))), der(3, bytes(0), privateBytes(name)),
    ]) assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, inner)), dataError);
    assert.throws(() => parseOkpDer("pkcs8", der(0x30, integer(0), algorithm(name), der(0x24, der(4, der(4, privateBytes(name)))))), dataError);
  });

  test(name + " PKCS8 uses RFC 5208 version zero and rejects OneAsymmetricKey public fields", () => {
    for (const version of [integer(), integer(1), integer(2), integer(0, 0), integer(0xff), der(5)]) {
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), version)), dataError);
    }
    for (const tail of [der(0x81, bytes(0), okpRawPublic(name)), der(0xa1, der(3, bytes(0), okpRawPublic(name))), der(5)]) {
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(0), tail)), dataError);
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(1), tail)), dataError);
    }
  });

  test(name + " PKCS8 validates optional attributes without changing private octets", () => {
    const attributeOid = der(6, bytes(0x2a, 3));
    const attribute = der(0x30, attributeOid, der(0x31, der(0x0c, bytes(0x61))));
    for (const tail of [der(0xa0), der(0xa0, attribute)]) {
      assert.deepEqual(parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(0), tail)).d, privateBytes(name));
    }
    for (const tail of [
      concat(der(0xa0, attribute), der(0xa0)),
      der(0xa0, der(0x30, attributeOid, der(0x31))),
      der(0xa0, der(0x30, attributeOid, der(0x31, integer(2), integer(1)))),
      der(0xa0, der(0x30, der(6, bytes(0x80, 0x2a)), der(0x31, integer(1)))),
    ]) assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(0), tail)), dataError);
  });
}
