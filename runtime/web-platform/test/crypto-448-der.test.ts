// Secure Curves §§4.3, 6.4; RFC 8410 §§3–4, 7; RFC 8032 §§5.2.2, 5.2.5;
// RFC 7748 §5; RFC 5208 §5; X.690 DER. No point or scalar mathematics here.
// https://wicg.github.io/webcrypto-secure-curves/
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { parseOkpDer } from "../src/crypto/der.ts";
import {
  curve448Pkcs8, curve448PrivateJwk, curve448RawPublic, curve448Spki,
} from "./curve448-fixtures.ts";
import type { Curve448FixtureName } from "./curve448-fixtures.ts";

function bytes(...values: number[]): Uint8Array { return new Uint8Array(values); }
function concat(...parts: readonly Uint8Array[]): Uint8Array { return new Uint8Array(Buffer.concat(parts)); }
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = concat(...parts);
  return concat(bytes(tag), value.length < 128 ? bytes(value.length)
    : value.length < 256 ? bytes(0x81, value.length) : bytes(0x82, value.length >>> 8, value.length & 255), value);
}
function integer(...value: number[]): Uint8Array { return der(2, bytes(...value)); }
function algorithm(name: Curve448FixtureName, parameters = bytes()): Uint8Array {
  return der(0x30, der(6, bytes(0x2b, 0x65, name === "Ed448" ? 0x71 : 0x6f)), parameters);
}
function privateBytes(name: Curve448FixtureName): Uint8Array {
  return new Uint8Array(Buffer.from(curve448PrivateJwk(name).d, "base64url"));
}
function spki(name: Curve448FixtureName, point = curve448RawPublic(name), parameters = bytes(), unused = 0): Uint8Array {
  return der(0x30, algorithm(name, parameters), der(3, bytes(unused), point));
}
function pkcs8(name: Curve448FixtureName, inner = der(4, privateBytes(name)), parameters = bytes(), version = integer(0), tail = bytes()): Uint8Array {
  return der(0x30, version, algorithm(name, parameters), der(4, inner), tail);
}
function dataError(error: unknown): boolean { return error instanceof DOMException && error.name === "DataError"; }

for (const name of ["Ed448", "X448"] as const) {
  const width = name === "Ed448" ? 57 : 56;
  for (const format of ["spki", "pkcs8"] as const) {
    test(name + " " + format + " decodes fixed RFC material at its exact encoded width", () => {
      const original = format === "spki" ? curve448Spki(name) : curve448Pkcs8(name);
      const padded = concat(bytes(7, 8), original, bytes(9));
      const result = parseOkpDer(format, padded.subarray(2, padded.length - 1));
      assert.equal(result.namedCurve, name);
      if (format === "spki") {
        assert.deepEqual(result.x, curve448RawPublic(name));
        assert.equal(result.x!.byteLength, width);
        assert.equal(result.x!.buffer, padded.buffer);
        assert.equal(result.d, undefined);
      } else {
        assert.deepEqual(result.d, privateBytes(name));
        assert.equal(result.d!.byteLength, width);
        assert.equal(result.d!.buffer, padded.buffer);
        assert.equal(result.x, undefined);
      }
    });

    test(name + " " + format + " requires the RFC 8410 OID with absent parameters", () => {
      for (const parameters of [der(5), der(0x30), der(4), der(6, bytes(0x2b, 0x65, 0x71)), der(5, bytes(0))]) {
        const encoded = format === "spki" ? spki(name, curve448RawPublic(name), parameters) : pkcs8(name, der(4, privateBytes(name)), parameters);
        assert.throws(() => parseOkpDer(format, encoded), dataError);
      }
      const encoded = format === "spki" ? spki(name) : pkcs8(name);
      const position = Buffer.from(encoded).indexOf(Buffer.from([6, 3, 0x2b, 0x65]));
      assert.ok(position >= 0);
      for (const oid of [0x6e, 0x70, name === "Ed448" ? 0x6f : 0x71, 0x72, 0xff]) {
        const altered = encoded.slice(); altered[position + 4] = oid;
        assert.throws(() => parseOkpDer(format, altered), dataError);
      }
      for (const at of [position + 2, position + 3]) {
        const altered = encoded.slice(); altered[at]! ^= 1;
        assert.throws(() => parseOkpDer(format, altered), dataError);
      }
    });

    test(name + " " + format + " consumes exactly one canonical DER envelope", () => {
      const encoded = format === "spki" ? spki(name) : pkcs8(name);
      for (let end = 0; end < encoded.length; end++) {
        assert.throws(() => parseOkpDer(format, encoded.subarray(0, end)), dataError);
      }
      assert.throws(() => parseOkpDer(format, concat(encoded, bytes(0))), dataError);
      const body = encoded.subarray(2);
      for (const altered of [
        concat(bytes(0x30, 0x80), body, bytes(0, 0)),
        concat(bytes(0x30, 0x81, body.length), body),
        concat(bytes(0x30, 0x82, 0, body.length), body),
        concat(bytes(0x30, 0x81, 255), body),
        concat(bytes(0x30, 0x87, 1, 0, 0, 0, 0, 0, 0), body),
        concat(bytes(0x31, body.length), body),
      ]) assert.throws(() => parseOkpDer(format, altered), dataError);
    });
  }

  test(name + " SPKI preserves opaque public octets and rejects every adjacent width", () => {
    for (const point of [new Uint8Array(width), new Uint8Array(width).fill(0xff), concat(bytes(1), new Uint8Array(width - 1))]) {
      assert.deepEqual(parseOkpDer("spki", spki(name, point)).x, point);
    }
    for (const size of [0, 32, width - 1, width + 1, width * 2]) {
      assert.throws(() => parseOkpDer("spki", spki(name, new Uint8Array(size))), dataError);
    }
  });

  test(name + " SPKI requires a primitive byte-aligned BIT STRING without suffixes", () => {
    for (const unused of [1, 7, 8, 255]) {
      assert.throws(() => parseOkpDer("spki", spki(name, curve448RawPublic(name), bytes(), unused)), dataError);
    }
    for (const encoded of [
      der(0x30, algorithm(name), der(3)),
      der(0x30, algorithm(name), der(0x23, der(3, bytes(0), curve448RawPublic(name)))),
      der(0x30, algorithm(name), der(4, curve448RawPublic(name))),
      der(0x30, algorithm(name), der(3, bytes(0), curve448RawPublic(name)), der(5)),
      der(0x30, der(3, bytes(0), curve448RawPublic(name))),
    ]) assert.throws(() => parseOkpDer("spki", encoded), dataError);
  });

  test(name + " PKCS8 contains exactly one nested primitive CurvePrivateKey", () => {
    for (const seed of [new Uint8Array(width), new Uint8Array(width).fill(0xff)]) {
      assert.deepEqual(parseOkpDer("pkcs8", pkcs8(name, der(4, seed))).d, seed);
    }
    for (const size of [0, 32, width - 1, width + 1, width * 2]) {
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, new Uint8Array(size)))), dataError);
    }
    for (const inner of [
      privateBytes(name), concat(der(4, privateBytes(name)), bytes(0)),
      concat(der(4, privateBytes(name)), der(5)), der(0x24, der(4, privateBytes(name))),
      der(0x30, integer(1), der(4, privateBytes(name))), der(3, bytes(0), privateBytes(name)),
    ]) assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, inner)), dataError);
    assert.throws(() => parseOkpDer("pkcs8", der(0x30, integer(0), algorithm(name), der(0x24, der(4, der(4, privateBytes(name)))))), dataError);
  });

  test(name + " PKCS8 uses version zero and rejects OneAsymmetricKey public fields", () => {
    for (const version of [integer(), integer(1), integer(2), integer(0, 0), integer(0xff), der(5)]) {
      assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), version)), dataError);
    }
    for (const suffix of [der(0x81, bytes(0), curve448RawPublic(name)), der(0xa1, der(3, bytes(0), curve448RawPublic(name))), der(5)]) {
      for (const version of [integer(0), integer(1)]) {
        assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), version, suffix)), dataError);
      }
    }
  });

  test(name + " PKCS8 accepts canonical optional attributes including long DER lengths", () => {
    const oid = der(6, bytes(0x2a, 3));
    const attribute = der(0x30, oid, der(0x31, der(0x0c, bytes(0x61))));
    const longAttribute = der(0x30, oid, der(0x31, der(4, new Uint8Array(200).fill(0x61))));
    for (const suffix of [der(0xa0), der(0xa0, attribute), der(0xa0, longAttribute)]) {
      assert.deepEqual(parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(0), suffix)).d, privateBytes(name));
    }
    for (const suffix of [
      concat(der(0xa0, attribute), der(0xa0)),
      der(0xa0, der(0x30, oid, der(0x31))),
      der(0xa0, der(0x30, oid, der(0x31, integer(2), integer(1)))),
      der(0xa0, der(0x30, der(6, bytes(0x80, 0x2a)), der(0x31, integer(1)))),
    ]) assert.throws(() => parseOkpDer("pkcs8", pkcs8(name, der(4, privateBytes(name)), bytes(), integer(0), suffix)), dataError);
  });
}

test("Ed448 uses the RFC 8032 57-octet encoding despite the draft raw-import 448-bit typo", () => {
  // Secure Curves §6.4 currently says 448 bits. RFC 8032 §§5.2.2 and 5.2.5
  // require 456-bit encodings: 57-byte public points and original private seeds.
  assert.equal(parseOkpDer("spki", spki("Ed448")).x!.byteLength, 57);
  assert.equal(parseOkpDer("pkcs8", pkcs8("Ed448")).d!.byteLength, 57);
  assert.throws(() => parseOkpDer("spki", spki("Ed448", new Uint8Array(56))), dataError);
  assert.throws(() => parseOkpDer("pkcs8", pkcs8("Ed448", der(4, new Uint8Array(56)))), dataError);
});
