// Specification controls: Web Cryptography §§9, 13–17, 23.7.3–5, 24.4.1/3/4;
// RFC 5480 §2, RFC 5915 §3, RFC 7517 §4 and RFC 7518 §6.2.
import assert from "node:assert/strict";
import { createPrivateKey, ECDH } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import type { EcAlgorithmName } from "../src/crypto/algorithms.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type {
  CryptoEcComponents, CryptoFailure, CryptoKeyComponents, CryptoKeyHandle, CryptoKeyImport,
  CryptoKeyPairGeneration, CryptoKeyPairRecord, CryptoKeyRecord, CryptoNamedCurve,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { ecOrder, ecPkcs8, ecPrivateJwk, ecPublicJwk, ecRawPublic, ecSpki, ecdhPrivateJwk, ecdhPublicJwk } from "./ec-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  exports = 0;
  componentExports = 0;
  generations = 0;
  importInput: CryptoKeyImport | undefined;
  exportFormat: "raw" | "spki" | "pkcs8" | undefined;
  generationInput: CryptoKeyPairGeneration | undefined;
  importFailure: CryptoFailure | undefined;
  exportFailure: CryptoFailure | undefined;
  generationFailure: CryptoFailure | undefined;
  importRecord: CryptoKeyRecord | undefined;
  generationRecord: CryptoKeyPairRecord | undefined;
  exportBytes: Uint8Array | undefined;
  exportParts: CryptoKeyComponents | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    this.importInput = input;
    return this.importFailure ?? this.importRecord ?? super.importKey(input);
  }
  override exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    this.exports++;
    this.exportFormat = format;
    return this.exportFailure ?? this.exportBytes ?? super.exportKey(key, format);
  }
  override exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure {
    this.componentExports++;
    return this.exportFailure ?? this.exportParts ?? super.exportComponents(key);
  }
  override generateKeyPair(parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure {
    this.generations++;
    this.generationInput = parameters;
    return this.generationFailure ?? this.generationRecord ?? super.generateKeyPair(parameters);
  }
}

function fixture(provider = new RecordingProvider()) {
  const scheduler = new VirtualScheduler();
  let fills = 0;
  const subtle = createCrypto({ fill(bytes) { fills++; bytes.fill(0x42); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function imported(type: "public" | "private", name: EcAlgorithmName = "ECDSA", namedCurve: CryptoNamedCurve = "P-256", extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey(type === "public" ? "spki" : "pkcs8", type === "public" ? ecSpki(namedCurve) : ecPkcs8(namedCurve),
      { name, namedCurve }, extractable, usagesFor(name, type)));
  }
  return { provider, scheduler, subtle, settle, imported, fills: () => fills };
}
function dom(name: string): (error: unknown) => boolean { return (error) => error instanceof DOMException && error.name === name; }
function pair(result: CryptoKey | CryptoKeyPair): CryptoKeyPair {
  assert.ok("privateKey" in result && "publicKey" in result);
  return result;
}
function jwk(result: ArrayBuffer | JsonWebKeyObject): JsonWebKeyObject { assert.ok(!(result instanceof ArrayBuffer)); return result; }
function buffer(result: ArrayBuffer | JsonWebKeyObject): Uint8Array { assert.ok(result instanceof ArrayBuffer); return new Uint8Array(result); }
function usagesFor(name: EcAlgorithmName, type: "public" | "private"): KeyUsage[] {
  return name === "ECDSA" ? [type === "public" ? "verify" : "sign"] : type === "private" ? ["deriveKey", "deriveBits"] : [];
}
function parts(data: JsonWebKeyObject): CryptoEcComponents {
  const x = new Uint8Array(Buffer.from(data.x!, "base64url"));
  const y = new Uint8Array(Buffer.from(data.y!, "base64url"));
  return data.d === undefined ? { family: "EC", namedCurve: data.crv as CryptoNamedCurve, x, y }
    : { family: "EC", namedCurve: data.crv as CryptoNamedCurve, x, y, d: new Uint8Array(Buffer.from(data.d, "base64url")) };
}
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = Buffer.concat(parts);
  const length = value.byteLength;
  const lengthBytes = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >>> 8, length & 255];
  return new Uint8Array(Buffer.concat([Buffer.from([tag, ...lengthBytes]), value]));
}
function scalarOnlyPkcs8(curve: CryptoNamedCurve, d: Uint8Array): Uint8Array {
  const oid = curve === "P-256" ? [0x2a, 0x86, 0x48, 0xce, 0x3d, 3, 1, 7] : [0x2b, 0x81, 4, 0, curve === "P-384" ? 0x22 : 0x23];
  return der(0x30, der(0x02, new Uint8Array([0])),
    der(0x30, der(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 2, 1])), der(0x06, new Uint8Array(oid))),
    der(0x04, der(0x30, der(0x02, new Uint8Array([1])), der(0x04, d))));
}
const curves: readonly CryptoNamedCurve[] = ["P-256", "P-384", "P-521"];
const names: readonly EcAlgorithmName[] = ["ECDSA", "ECDH"];

for (const name of names) {
  for (const namedCurve of curves) {
    test(name + " / " + namedCurve + " imports and exports raw public, SPKI, PKCS8 and JWK", async () => {
      const f = fixture();
      for (const format of ["raw", "spki", "jwk"] as const) {
        const data = format === "raw" ? ecRawPublic(namedCurve) : format === "spki" ? ecSpki(namedCurve) : ecPublicJwk(namedCurve);
        const usages = usagesFor(name, "public");
        const key = await f.settle(f.subtle.importKey(format, data, { name, namedCurve }, true, usages));
        assert.equal(key.type, "public");
        assert.equal(key.extractable, true);
        assert.deepEqual(key.algorithm, { name, namedCurve });
        assert.deepEqual(Object.keys(key.algorithm), ["name", "namedCurve"]);
        assert.deepEqual(key.usages, usages);
        const input = f.provider.importInput;
        assert.ok(input !== undefined);
        if (input.format === "raw" || input.format === "spki") assert.equal(input.bytes, data, "native import borrows the exact byte view synchronously");
        else assert.ok(input.format === "components" && input.components.family === "EC");
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("raw", key))), ecRawPublic(namedCurve));
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("spki", key))), ecSpki(namedCurve));
        assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", key))), { ...ecPublicJwk(namedCurve), ext: true, key_ops: usages });
      }
      for (const format of ["pkcs8", "jwk"] as const) {
        const data = format === "pkcs8" ? ecPkcs8(namedCurve) : ecPrivateJwk(namedCurve);
        const usages = usagesFor(name, "private");
        const key = await f.settle(f.subtle.importKey(format, data, { name, namedCurve }, true, usages));
        assert.equal(key.type, "private");
        assert.deepEqual(key.algorithm, { name, namedCurve });
        assert.deepEqual(key.usages, usages);
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), ecPkcs8(namedCurve));
        const exported = jwk(await f.settle(f.subtle.exportKey("jwk", key)));
        assert.equal(exported.alg, undefined, "EC exports do not invent an algorithm/hash binding");
        assert.deepEqual(exported, { ...ecPrivateJwk(namedCurve), ext: true, key_ops: usages });
        const restricted = await f.settle(f.subtle.importKey("jwk", exported, { name, namedCurve }, false, usages));
        assert.equal(restricted.extractable, false);
        await assert.rejects(f.settle(f.subtle.exportKey("jwk", restricted)), dom("InvalidAccessError"));
      }
      assert.equal(f.provider.imports, 7);
      assert.equal(f.fills(), 0, "EC key generation/import does not use the JS RandomSource");
    });

    test(name + " / " + namedCurve + " generation splits usages and isolates cached key metadata", async () => {
      const f = fixture();
      const usages = name === "ECDSA" ? ["verify", "sign", "verify"] : ["deriveBits", "deriveKey", "deriveBits"];
      const generated = pair(await f.settle(f.subtle.generateKey({ name, namedCurve }, false, usages)));
      assert.deepEqual(Object.keys(generated), ["privateKey", "publicKey"]);
      assert.equal(generated.publicKey.type, "public");
      assert.equal(generated.privateKey.type, "private");
      assert.equal(generated.publicKey.extractable, true);
      assert.equal(generated.privateKey.extractable, false);
      assert.deepEqual(generated.publicKey.usages, usagesFor(name, "public"));
      assert.deepEqual(generated.privateKey.usages, usagesFor(name, "private"));
      assert.deepEqual(generated.publicKey.algorithm, { name, namedCurve });
      assert.deepEqual(generated.privateKey.algorithm, { name, namedCurve });
      assert.notEqual(generated.publicKey.algorithm, generated.privateKey.algorithm);
      assert.equal(generated.publicKey.algorithm, generated.publicKey.algorithm);
      const view = generated.publicKey.algorithm as { name: string; namedCurve: string };
      view.name = "changed"; view.namedCurve = "changed";
      generated.publicKey.usages.push("encrypt");
      const exported = jwk(await f.settle(f.subtle.exportKey("jwk", generated.publicKey)));
      assert.equal(exported.crv, namedCurve);
      assert.deepEqual(exported.key_ops, usagesFor(name, "public"));
      assert.deepEqual(generated.privateKey.algorithm, { name, namedCurve });
      assert.equal(f.provider.generations, 1);
      assert.deepEqual(f.provider.generationInput, { family: "EC", namedCurve });
      assert.equal(f.fills(), 0);
    });
  }

  test(name + " generation validates usages before the curve, then rejects empty private usages after generation", async () => {
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.generateKey({ name, namedCurve: "unsupported" }, true, ["encrypt"])), dom("SyntaxError"));
    await assert.rejects(f.settle(f.subtle.generateKey({ name, namedCurve: "p-256" }, true, usagesFor(name, "private"))), dom("NotSupportedError"));
    assert.equal(f.provider.generations, 0);
    await assert.rejects(f.settle(f.subtle.generateKey({ name, namedCurve: "P-256" }, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.generations, 1);
    if (name === "ECDSA") {
      await assert.rejects(f.settle(f.subtle.generateKey({ name, namedCurve: "P-256" }, true, ["verify"])), dom("SyntaxError"));
      assert.equal(f.provider.generations, 2);
    }
  });

  test(name + " import validates curve before usages, usages before encoding, and empty private usages last", async () => {
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("spki", new Uint8Array(), { name, namedCurve: "unsupported" }, true, ["encrypt"])), dom("NotSupportedError"));
    for (const format of ["raw", "spki", "pkcs8"] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), { name, namedCurve: "P-256" }, true, ["encrypt"])), dom("SyntaxError"));
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), { name, namedCurve: "P-256" }, true, [])), dom("DataError"));
    }
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { kty: "wrong", d: "" }, { name, namedCurve: "P-256" }, true, ["verify"])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 0);
    const publicKey = await f.settle(f.subtle.importKey("spki", ecSpki(), { name, namedCurve: "P-256" }, false, []));
    assert.equal(publicKey.type, "public");
    assert.equal(publicKey.extractable, false);
    assert.deepEqual(publicKey.usages, []);
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", ecPkcs8(), { name, namedCurve: "P-256" }, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 2);
    assert.equal(f.provider.componentExports, 1, "supplied private/public consistency precedes the common empty-usage check");
  });
}

test("EC DER and JWK curve mismatches fail before native import", async () => {
  const f = fixture();
  for (const name of names) {
    for (const [format, data, usages] of [
      ["spki", ecSpki("P-384"), usagesFor(name, "public")],
      ["pkcs8", ecPkcs8("P-384"), usagesFor(name, "private")],
      ["jwk", ecPrivateJwk("P-384"), usagesFor(name, "private")],
    ] as const) await assert.rejects(f.settle(f.subtle.importKey(format, data, { name, namedCurve: "P-256" }, true, usages)), dom("DataError"));
  }
  assert.equal(f.provider.imports, 0);
});

test("EC imports require uncompressed points even when the native decoder accepts compressed form", async () => {
  const f = fixture();
  const compressed = ECDH.convertKey(ecRawPublic(), "prime256v1", undefined, undefined, "compressed") as Buffer;
  const native = new NodeCryptoProvider().importKey({ format: "raw", family: "EC", namedCurve: "P-256", bytes: compressed });
  assert.ok(!("failure" in native), "control: native compressed decoding succeeds");
  await assert.rejects(f.settle(f.subtle.importKey("raw", compressed, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])), dom("DataError"));
  assert.equal(f.provider.imports, 0, "optional compressed format is explicitly unsupported in shared policy");
});

test("EC JWK policy enforces kty, use, key_ops, ext and the declared curve", async () => {
  for (const name of names) {
    const f = fixture();
    const usages = usagesFor(name, "private");
    const allowed = usages[0]!;
    const bad: readonly JsonWebKeyObject[] = [
      { ...ecPrivateJwk(), kty: "ec" }, { ...ecPrivateJwk(), kty: "RSA" },
      { ...ecPrivateJwk(), use: name === "ECDSA" ? "enc" : "sig" },
      { ...ecPrivateJwk(), use: "other" },
      { ...ecPrivateJwk(), key_ops: [allowed, allowed] },
      { ...ecPrivateJwk(), key_ops: ["unknown", "unknown", ...usages] },
      { ...ecPrivateJwk(), key_ops: [] },
      { ...ecPrivateJwk(), use: "sig", key_ops: ["sign", "deriveKey", "deriveBits"] },
      { ...ecPrivateJwk(), use: "enc", key_ops: ["sign", "deriveKey", "deriveBits"] },
      { ...ecPrivateJwk(), ext: false },
      { ...ecPrivateJwk(), crv: "p-256" }, { ...ecPrivateJwk(), crv: undefined },
    ];
    for (const data of bad) await assert.rejects(f.settle(f.subtle.importKey("jwk", data, { name, namedCurve: "P-256" }, true, usages)), dom("DataError"));
    assert.equal(f.provider.imports, 0);
    const accepted = await f.settle(f.subtle.importKey("jwk", { ...ecPrivateJwk(), key_ops: ["unknown", ...usages], ext: false }, { name, namedCurve: "P-256" }, false, usages));
    assert.deepEqual(accepted.usages, usages);
    const empty = await f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(), use: "arbitrary", key_ops: [] }, { name, namedCurve: "P-256" }, true, []));
    assert.deepEqual(empty.usages, []);
  }
});

test("ECDSA JWK alg binds to curve while ECDH does not interpret alg", async () => {
  const f = fixture();
  for (const namedCurve of curves) {
    const expected = namedCurve === "P-256" ? "ES256" : namedCurve === "P-384" ? "ES384" : "ES512";
    for (const alg of [undefined, expected]) {
      const key = await f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(namedCurve), alg }, { name: "ECDSA", namedCurve }, true, ["verify"]));
      assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).alg, undefined);
    }
    for (const alg of ["ES256", "ES384", "ES512", "ES521", "es256", "", "ECDH-ES"]) {
      if (alg !== expected) await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(namedCurve), alg }, { name: "ECDSA", namedCurve }, true, ["verify"])), dom("DataError"));
      const agreement = await f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(namedCurve), alg }, { name: "ECDH", namedCurve }, true, []));
      assert.equal(agreement.type, "public");
    }
  }
});

test("EC JWK requires full-width unpadded base64url x, y and private d", async () => {
  const f = fixture();
  for (const namedCurve of curves) {
    for (const member of ["x", "y", "d"] as const) {
      const original = ecPrivateJwk(namedCurve);
      const octets = Buffer.from(original[member], "base64url");
      for (const value of [undefined, "", "AA", octets.subarray(1).toString("base64url"), Buffer.concat([Buffer.from([0]), octets]).toString("base64url"), original[member] + "=", "!", "A"]) {
        if (member === "d" && value === undefined) continue;
        await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...original, [member]: value }, { name: "ECDSA", namedCurve }, true, ["sign"])), dom("DataError"), namedCurve + ":" + member);
      }
    }
  }
  assert.equal(f.provider.imports, 0);
});

test("P-521 scalar leading zeros are mandatory encoding even when native import accepts a shortened scalar", async () => {
  const original = parts(ecPrivateJwk("P-521"));
  assert.equal(original.d![0], 0);
  const shortened = { ...original, d: original.d!.subarray(1) };
  const native = new NodeCryptoProvider().importKey({ format: "components", components: shortened });
  assert.ok(!("failure" in native), "control: native scalar import accepts the same integer without its leading zero");
  const f = fixture();
  await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...ecPrivateJwk("P-521"), d: Buffer.from(shortened.d).toString("base64url") }, { name: "ECDSA", namedCurve: "P-521" }, true, ["sign"])), dom("DataError"));
  await assert.rejects(f.settle(f.subtle.importKey("pkcs8", scalarOnlyPkcs8("P-521", shortened.d), { name: "ECDSA", namedCurve: "P-521" }, true, ["sign"])), dom("DataError"));
  assert.equal(f.provider.imports, 0);
});

test("EC native mathematical validation rejects off-curve points and zero or out-of-range scalars", async () => {
  const f = fixture();
  for (const namedCurve of curves) {
    const valid = ecPrivateJwk(namedCurve);
    const width = Buffer.from(valid.x, "base64url").byteLength;
    const zero = Buffer.alloc(width).toString("base64url");
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(namedCurve), x: zero, y: zero }, { name: "ECDSA", namedCurve }, true, ["verify"])), dom("DataError"));
    for (const d of [zero, Buffer.from(ecOrder(namedCurve)).toString("base64url"), Buffer.alloc(width, 255).toString("base64url")]) {
      await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...valid, d }, { name: "ECDH", namedCurve }, true, ["deriveBits"])), dom("DataError"));
    }
  }
  assert.equal(f.provider.imports, 12, "fixed-width mathematical validity belongs to native import");
});

for (const namedCurve of curves) {
  test(namedCurve + " private JWK rejects a valid public point belonging to another scalar", async () => {
    const supplied = { ...ecPrivateJwk(namedCurve), ...ecdhPublicJwk(namedCurve, "initiator") };
    const native = new NodeCryptoProvider();
    const accepted = native.importKey({ format: "components", components: parts(supplied) });
    assert.ok(!("failure" in accepted), "control: native private import produces the key represented by d");
    const actual = native.exportComponents(accepted.handle);
    assert.ok(!("failure" in actual) && actual.family === "EC");
    assert.equal(Buffer.from(actual.x).toString("base64url"), ecPrivateJwk(namedCurve).x);
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("jwk", supplied, { name: "ECDSA", namedCurve }, true, ["sign"])), dom("DataError"));
    assert.equal(f.provider.imports, 1);
    assert.equal(f.provider.componentExports, 1);
  });

  test(namedCurve + " PKCS8 supplied point must match d; absent point and parameters remain importable", async () => {
    const encoded = ecPkcs8(namedCurve);
    const originalPoint = ecRawPublic(namedCurve);
    const pointAt = Buffer.from(encoded).indexOf(Buffer.from(originalPoint));
    assert.ok(pointAt >= 0);
    const other = ecdhPublicJwk(namedCurve, "initiator");
    const otherPoint = Buffer.concat([Buffer.from([4]), Buffer.from(other.x, "base64url"), Buffer.from(other.y, "base64url")]);
    encoded.set(otherPoint, pointAt);
    const native = new NodeCryptoProvider().importKey({ format: "pkcs8", bytes: encoded });
    assert.ok(!("failure" in native), "control: native decoder can read a mismatching redundant public point");
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", encoded, { name: "ECDH", namedCurve }, true, ["deriveBits"])), dom("DataError"));
    const scalar = parts(ecPrivateJwk(namedCurve)).d!;
    const key = await f.settle(f.subtle.importKey("pkcs8", scalarOnlyPkcs8(namedCurve, scalar), { name: "ECDSA", namedCurve }, true, ["sign"]));
    assert.equal(f.provider.imports, 2);
    assert.equal(f.provider.componentExports, 1, "a missing redundant point needs no component comparison");
    assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), ecPkcs8(namedCurve));
  });
}

test("EC public JWK ignores unrelated private fields when d is absent", async () => {
  const f = fixture();
  const key = await f.settle(f.subtle.importKey("jwk", { ...ecPublicJwk(), p: "!", q: "!", dp: "!", dq: "!", qi: "!", oth: [{}], k: "!" }, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]));
  assert.equal(key.type, "public");
  const input = f.provider.importInput;
  assert.ok(input?.format === "components" && input.components.family === "EC");
  assert.deepEqual(Object.keys(input.components), ["family", "namedCurve", "x", "y"]);
});

for (const failure of ["invalid-key", "operation"] as const) {
  test("EC maps native " + failure + " results at import, generate, inspection and export boundaries", async () => {
    const f = fixture();
    f.provider.importFailure = { failure };
    for (const [format, data] of [["raw", ecRawPublic()], ["spki", ecSpki()], ["jwk", ecPublicJwk()]] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, data, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    f.provider.importFailure = undefined;
    const key = await f.imported("public");
    f.provider.exportFailure = { failure };
    for (const format of ["raw", "spki", "pkcs8", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", ecPkcs8(), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])), dom("OperationError"));
    f.provider.generationFailure = { failure };
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])), dom("OperationError"));
  });
}

test("EC export checks extractability, material access and requested type in order", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  const restricted = await f.imported("private", "ECDSA", "P-256", false);
  const inspections = f.provider.componentExports;
  for (const format of ["raw", "spki", "pkcs8", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, restricted)), dom("InvalidAccessError"));
  assert.equal(f.provider.exports, 0);
  assert.equal(f.provider.componentExports, inspections);
  await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", publicKey)), dom("InvalidAccessError"));
  assert.equal(f.provider.exportFormat, "spki");
  for (const format of ["spki", "raw"]) {
    await assert.rejects(f.settle(f.subtle.exportKey(format, privateKey)), dom("InvalidAccessError"));
    assert.equal(f.provider.exportFormat, "pkcs8");
  }
  assert.equal(f.provider.exports, 3);
});

test("EC import and generation reject metadata inconsistent with actual requested key type and curve", async () => {
  const underlying = new NodeCryptoProvider().importKey({ format: "spki", bytes: ecSpki() });
  assert.ok(!("failure" in underlying));
  const f = fixture();
  for (const info of [
    { family: "secret", type: "secret", length: 256 } as const,
    { family: "EC", type: "private", namedCurve: "P-256" } as const,
    { family: "EC", type: "public", namedCurve: "P-384" } as const,
    { family: "EC", type: "public", namedCurve: "prime256v1" } as const,
  ]) {
    f.provider.importRecord = { handle: underlying.handle, info };
    await assert.rejects(f.settle(f.subtle.importKey("spki", ecSpki(), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])), dom("OperationError"));
  }
  f.provider.generationRecord = { publicKey: underlying, privateKey: underlying };
  await assert.rejects(f.settle(f.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])), dom("OperationError"));
});

test("EC import rejects inconsistent native component metadata or changed private scalar", async () => {
  const f = fixture();
  const original = parts(ecPrivateJwk());
  for (const altered of [
    { family: "secret", k: new Uint8Array([1]) } as const,
    { ...original, namedCurve: "P-384" } as const,
    { ...original, x: original.x.subarray(1) },
    { ...original, d: undefined },
    { ...original, d: parts(ecdhPrivateJwk("P-256", "initiator")).d },
  ]) {
    f.provider.exportParts = altered;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", ecPkcs8(), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])), dom("OperationError"));
  }
});

test("EC exports reject nonconforming native encodings and components", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  for (const [format, key, invalid] of [
    ["raw", publicKey, ecRawPublic().subarray(1)],
    ["spki", publicKey, ecSpki("P-384")],
    ["pkcs8", privateKey, ecPkcs8("P-384")],
    ["pkcs8", privateKey, scalarOnlyPkcs8("P-256", parts(ecPrivateJwk()).d!)],
  ] as const) {
    f.provider.exportBytes = invalid;
    await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
  }
  // A native PKCS8 export alone is not sufficient: it omits inner parameters.
  f.provider.exportBytes = new Uint8Array(createPrivateKey({ key: Buffer.from(ecPkcs8()), format: "der", type: "pkcs8" }).export({ format: "der", type: "pkcs8" }));
  await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", privateKey)), dom("OperationError"));
  f.provider.exportBytes = undefined;
  const original = parts(ecPrivateJwk());
  for (const altered of [
    { family: "secret", k: new Uint8Array([1]) } as const,
    { ...original, namedCurve: "P-384" } as const,
    { ...original, x: original.x.subarray(1) },
    { ...original, y: original.y.subarray(1) },
    { ...original, d: undefined },
    { ...original, d: original.d!.subarray(1) },
  ]) {
    f.provider.exportParts = altered;
    await assert.rejects(f.settle(f.subtle.exportKey("jwk", privateKey)), dom("OperationError"));
  }
});

test("EC exports own their buffers and JWK dictionaries independently of public cached metadata", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  for (const [format, key, expected] of [["raw", publicKey, ecRawPublic()], ["spki", publicKey, ecSpki()], ["pkcs8", privateKey, ecPkcs8()]] as const) {
    const first = buffer(await f.settle(f.subtle.exportKey(format, key)));
    const second = buffer(await f.settle(f.subtle.exportKey(format, key)));
    assert.notEqual(first.buffer, second.buffer);
    assert.equal(first.byteOffset, 0);
    assert.equal(first.buffer.byteLength, first.byteLength);
    first.fill(0);
    assert.deepEqual(second, expected);
  }
  const dictionary = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  dictionary.x = "AA"; dictionary.key_ops!.push("verify");
  const publicAlgorithm = privateKey.algorithm as { name: string; namedCurve: string };
  publicAlgorithm.namedCurve = "P-521";
  privateKey.usages.push("verify");
  const next = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  assert.equal(next.x, ecPrivateJwk().x);
  assert.equal(next.crv, "P-256");
  assert.deepEqual(next.key_ops, ["sign"]);
  assert.equal(getCryptoKeySlots(privateKey).algorithm.name, "ECDSA");
});

test("EC imports complete synchronously before one scheduled settlement and retain no input alias", async () => {
  const f = fixture();
  const encoded = ecPkcs8();
  const promise = f.subtle.importKey("pkcs8", encoded, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  assert.equal(f.provider.imports, 1);
  assert.equal(f.provider.componentExports, 1);
  encoded.fill(0);
  let settled = false;
  void promise.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  const key = await f.settle(promise);
  assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), ecPkcs8());
  const bad = f.subtle.importKey("spki", new Uint8Array(), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  assert.equal(f.provider.imports, 1);
  await assert.rejects(f.settle(bad), dom("DataError"));
});
