// Specification controls: Web Cryptography §9, §§23.7.4–5, 24.4.3–4;
// RFC 5480 §2; RFC 5915 §3; RFC 5208 §5; X.690 DER.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { parseEcDer, parseEcPoint } from "../src/crypto/der.ts";
import type { CryptoNamedCurve } from "../src/provider/crypto.ts";
import { ecPkcs8, ecPrivateJwk, ecRawPublic, ecSpki } from "./ec-fixtures.ts";

function bytes(...values: number[]): Uint8Array { return new Uint8Array(values); }
function concat(...parts: readonly Uint8Array[]): Uint8Array { return new Uint8Array(Buffer.concat(parts)); }
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = concat(...parts);
  const length = value.length;
  return concat(bytes(tag), length < 128 ? bytes(length) : length < 256 ? bytes(0x81, length) : bytes(0x82, length >>> 8, length & 255), value);
}
function integer(...value: number[]): Uint8Array { return der(0x02, bytes(...value)); }
function content(value: Uint8Array): Uint8Array { return value.subarray(value[1]! < 128 ? 2 : 2 + (value[1]! & 127)); }
const curves: readonly CryptoNamedCurve[] = ["P-256", "P-384", "P-521"];
const ecOid = der(0x06, bytes(0x2a, 0x86, 0x48, 0xce, 0x3d, 2, 1));
function curveOid(curve: CryptoNamedCurve): Uint8Array {
  return der(0x06, curve === "P-256" ? bytes(0x2a, 0x86, 0x48, 0xce, 0x3d, 3, 1, 7) : bytes(0x2b, 0x81, 4, 0, curve === "P-384" ? 0x22 : 0x23));
}
function algorithm(curve: CryptoNamedCurve, parameters = curveOid(curve)): Uint8Array { return der(0x30, ecOid, parameters); }
function scalar(curve: CryptoNamedCurve): Uint8Array { return new Uint8Array(Buffer.from(ecPrivateJwk(curve).d!, "base64url")); }
function publicField(point: Uint8Array): Uint8Array { return der(0xa1, der(0x03, bytes(0), point)); }
function privateKey(curve: CryptoNamedCurve, d = scalar(curve), parameters = der(0xa0, curveOid(curve)), point = publicField(ecRawPublic(curve)), version = integer(1)): Uint8Array {
  return der(0x30, version, der(0x04, d), parameters, point);
}
function spki(curve: CryptoNamedCurve, point = ecRawPublic(curve), parameters = curveOid(curve), unused = 0): Uint8Array {
  return der(0x30, algorithm(curve, parameters), der(0x03, bytes(unused), point));
}
function pkcs8(curve: CryptoNamedCurve, key = privateKey(curve), parameters = curveOid(curve), version = integer(0), attributes = bytes()): Uint8Array {
  return der(0x30, version, algorithm(curve, parameters), der(0x04, key), attributes);
}
function dataError(error: unknown): boolean { return error instanceof DOMException && error.name === "DataError"; }

for (const curve of curves) {
  for (const format of ["spki", "pkcs8"] as const) {
    test(curve + " " + format + " parses fixed independent encodings into borrowed full-width components", () => {
      const encoded = format === "spki" ? ecSpki(curve) : ecPkcs8(curve);
      const key = parseEcDer(format, encoded, true);
      const jwk = ecPrivateJwk(curve);
      assert.equal(key.namedCurve, curve);
      assert.equal(Buffer.from(key.x!).toString("base64url"), jwk.x);
      assert.equal(Buffer.from(key.y!).toString("base64url"), jwk.y);
      assert.equal(key.x!.buffer, encoded.buffer);
      assert.equal(key.y!.buffer, encoded.buffer);
      if (format === "pkcs8") {
        assert.equal(Buffer.from(key.d!).toString("base64url"), jwk.d);
        assert.equal(key.d!.buffer, encoded.buffer);
      } else assert.equal(key.d, undefined);
      if (curve === "P-521") assert.equal(key.x!.length, 66, "leading zero octets remain part of a fixed-width field element");
    });
  }

  test(curve + " raw points use uncompressed fixed-width coordinates", () => {
    const point = ecRawPublic(curve);
    const parsed = parseEcPoint(point, curve);
    const jwk = ecPrivateJwk(curve);
    assert.equal(Buffer.from(parsed.x).toString("base64url"), jwk.x);
    assert.equal(Buffer.from(parsed.y).toString("base64url"), jwk.y);
    assert.equal(parsed.x.buffer, point.buffer);
    for (const invalid of [bytes(), bytes(0), point.subarray(1), point.subarray(0, point.length - 1), concat(point, bytes(0))]) {
      assert.throws(() => parseEcPoint(invalid, curve), dataError);
      assert.throws(() => parseEcDer("spki", spki(curve, invalid)), dataError);
    }
    for (const tag of [0, 2, 3, 6, 7, 0xff]) {
      const invalid = point.slice(); invalid[0] = tag;
      assert.throws(() => parseEcPoint(invalid, curve), dataError);
      assert.throws(() => parseEcDer("spki", spki(curve, invalid)), dataError);
    }
    const compressed = concat(bytes(2), parsed.x);
    assert.throws(() => parseEcPoint(compressed, curve), dataError, "compressed format is optional and unsupported");
  });

  test(curve + " PKCS8 imports permit absent inner fields but exports require both", () => {
    for (const parameters of [bytes(), der(0xa0, curveOid(curve))]) {
      for (const point of [bytes(), publicField(ecRawPublic(curve))]) {
        const encoded = pkcs8(curve, privateKey(curve, scalar(curve), parameters, point));
        const parsed = parseEcDer("pkcs8", encoded);
        assert.deepEqual(parsed.d, scalar(curve));
        assert.equal(parsed.x === undefined, point.length === 0);
        if (parameters.length === 0 || point.length === 0) assert.throws(() => parseEcDer("pkcs8", encoded, true), dataError);
        else assert.equal(parseEcDer("pkcs8", encoded, true).namedCurve, curve);
      }
    }
  });

  test(curve + " PKCS8 scalar is a fixed-width primitive octet string", () => {
    const d = scalar(curve);
    for (const invalid of [bytes(), d.subarray(1), concat(bytes(0), d)]) {
      assert.throws(() => parseEcDer("pkcs8", pkcs8(curve, privateKey(curve, invalid))), dataError);
    }
    const constructed = der(0x30, integer(1), der(0x24, der(0x04, d)), der(0xa0, curveOid(curve)), publicField(ecRawPublic(curve)));
    assert.throws(() => parseEcDer("pkcs8", pkcs8(curve, constructed)), dataError);
    // Zero/range/point mathematics are deliberately left to the native importer.
    assert.equal(parseEcDer("pkcs8", pkcs8(curve, privateKey(curve, new Uint8Array(d.length)))).d!.length, d.length);
  });
}

for (const format of ["spki", "pkcs8"] as const) {
  test("EC " + format + " requires id-ecPublicKey and a supported present namedCurve", () => {
    for (const parameters of [bytes(), der(0x05), der(0x30), der(0x06, bytes(0x2b, 0x81, 4, 0, 0x0a)), concat(curveOid("P-256"), der(0x05))]) {
      const encoded = format === "spki" ? spki("P-256", ecRawPublic(), parameters) : pkcs8("P-256", privateKey("P-256"), parameters);
      assert.throws(() => parseEcDer(format, encoded), dataError);
    }
    const encoded = format === "spki" ? spki("P-256") : pkcs8("P-256");
    const altered = encoded.slice();
    const oidAt = Buffer.from(altered).indexOf(Buffer.from(ecOid));
    assert.ok(oidAt >= 0);
    altered[oidAt + ecOid.length - 1] = 2;
    assert.throws(() => parseEcDer(format, altered), dataError);
  });

  test("EC " + format + " rejects truncation, trailing data and nonminimal DER lengths", () => {
    const encoded = format === "spki" ? spki("P-256") : pkcs8("P-256");
    for (let length = 0; length < encoded.length; length++) assert.throws(() => parseEcDer(format, encoded.subarray(0, length)), dataError);
    assert.throws(() => parseEcDer(format, concat(encoded, bytes(0))), dataError);
    const body = content(encoded);
    for (const invalid of [
      concat(bytes(0x30, 0x80), body, bytes(0, 0)),
      concat(bytes(0x30, 0x82, 0, body.length), body),
      concat(bytes(0x30, 0x81, 255), body),
      concat(bytes(0x30, 0x87, 1, 0, 0, 0, 0, 0, 0), body),
    ]) assert.throws(() => parseEcDer(format, invalid), dataError);
    const wrongTag = encoded.slice(); wrongTag[0] = 0x31;
    assert.throws(() => parseEcDer(format, wrongTag), dataError);
  });
}

test("EC SPKI requires one primitive byte-aligned BIT STRING and no additional fields", () => {
  for (const unused of [1, 7, 8, 255]) assert.throws(() => parseEcDer("spki", spki("P-256", ecRawPublic(), curveOid("P-256"), unused)), dataError);
  for (const value of [
    der(0x30, algorithm("P-256"), der(0x03)),
    der(0x30, algorithm("P-256"), der(0x23, der(0x03, bytes(0), ecRawPublic()))),
    der(0x30, algorithm("P-256"), der(0x03, bytes(0), ecRawPublic()), der(0x05)),
    der(0x30, der(0x03, bytes(0), ecRawPublic())),
  ]) assert.throws(() => parseEcDer("spki", value), dataError);
});

test("EC PKCS8 and ECPrivateKey versions are canonical zero and one", () => {
  for (const version of [integer(), integer(1), integer(2), integer(0, 0), integer(0xff), der(0x05)]) {
    assert.throws(() => parseEcDer("pkcs8", pkcs8("P-256", privateKey("P-256"), curveOid("P-256"), version)), dataError);
  }
  for (const version of [integer(), integer(0), integer(2), integer(0, 1), integer(0xff), der(0x05)]) {
    assert.throws(() => parseEcDer("pkcs8", pkcs8("P-256", privateKey("P-256", scalar("P-256"), der(0xa0, curveOid("P-256")), publicField(ecRawPublic()), version))), dataError);
  }
});

test("EC PKCS8 inner parameters match outer parameters and optional fields remain ordered and unique", () => {
  for (const parameters of [der(0xa0), der(0xa0, curveOid("P-384")), der(0xa0, der(0x05)), der(0xa0, curveOid("P-256"), curveOid("P-256")), der(0x80, curveOid("P-256"))]) {
    assert.throws(() => parseEcDer("pkcs8", pkcs8("P-256", privateKey("P-256", scalar("P-256"), parameters))), dataError);
  }
  const parameters = der(0xa0, curveOid("P-256"));
  const point = publicField(ecRawPublic());
  for (const tail of [concat(parameters, parameters, point), concat(point, parameters), concat(point, point), der(0xa2), der(0xa1, der(0x03, bytes(1), ecRawPublic())), der(0xa1, der(0x03, bytes(0), ecRawPublic()), der(0x05))]) {
    const inner = der(0x30, integer(1), der(0x04, scalar("P-256")), tail);
    assert.throws(() => parseEcDer("pkcs8", pkcs8("P-256", inner)), dataError);
  }
});

test("EC PKCS8 validates both embedded consumption and optional attribute encoding", () => {
  const attributeOid = der(0x06, bytes(0x2a, 3));
  const attribute = der(0x30, attributeOid, der(0x31, der(0x0c, bytes(0x61))));
  assert.equal(parseEcDer("pkcs8", pkcs8("P-256", privateKey("P-256"), curveOid("P-256"), integer(0), der(0xa0, attribute))).namedCurve, "P-256");
  for (const value of [
    pkcs8("P-256", concat(privateKey("P-256"), bytes(0))),
    der(0x30, integer(0), algorithm("P-256"), der(0x24, der(0x04, privateKey("P-256")))),
    pkcs8("P-256", privateKey("P-256"), curveOid("P-256"), integer(0), der(0xa1)),
    pkcs8("P-256", privateKey("P-256"), curveOid("P-256"), integer(0), der(0xa0, der(0x30, attributeOid, der(0x31, integer(2), integer(1))))),
  ]) assert.throws(() => parseEcDer("pkcs8", value), dataError);
});
