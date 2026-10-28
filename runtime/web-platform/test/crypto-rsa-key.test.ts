// Specification controls: Web Cryptography §§9, 13–17, 20–22; RFC 7517 §4;
// RFC 7518 §§2 and 6.3. Native mathematics are supplied by test/node-crypto-provider.
import assert from "node:assert/strict";
import test from "node:test";
import { Crypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoKeyPair } from "../src/crypto/rsa-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type { RsaAlgorithmName } from "../src/crypto/algorithms.ts";
import { DOMException } from "../src/core/errors.ts";
import type {
  CryptoFailure, CryptoKeyComponents, CryptoKeyHandle, CryptoKeyImport, CryptoKeyPairGeneration,
  CryptoKeyPairRecord, CryptoKeyRecord, CryptoRsaComponents,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { rsaPkcs8, rsaPrivateJwk, rsaPublicJwk, rsaSpki } from "./rsa-fixtures.ts";

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
    return this.generationFailure ?? super.generateKeyPair(parameters);
  }
}

function fixture(provider = new RecordingProvider()) {
  const scheduler = new VirtualScheduler();
  let fills = 0;
  const subtle = new Crypto({ fill(bytes) { fills++; bytes.fill(0x42); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function imported(type: "public" | "private", name: RsaAlgorithmName = "RSASSA-PKCS1-v1_5", extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey(type === "public" ? "spki" : "pkcs8", type === "public" ? rsaSpki() : rsaPkcs8(),
      { name, hash: "SHA-256" }, extractable,
      name === "RSA-OAEP" ? (type === "public" ? ["encrypt", "wrapKey"] : ["decrypt", "unwrapKey"])
        : [type === "public" ? "verify" : "sign"]));
  }
  return { provider, scheduler, subtle, settle, imported, fills: () => fills };
}
function dom(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}
function pair(result: CryptoKey | CryptoKeyPair): CryptoKeyPair {
  assert.ok("privateKey" in result && "publicKey" in result);
  return result;
}
function jwk(result: ArrayBuffer | JsonWebKeyObject): JsonWebKeyObject {
  assert.ok(!(result instanceof ArrayBuffer));
  return result;
}
function buffer(result: ArrayBuffer | JsonWebKeyObject): Uint8Array {
  assert.ok(result instanceof ArrayBuffer);
  return new Uint8Array(result);
}
function alg(name: RsaAlgorithmName, hash = "SHA-256"): { name: RsaAlgorithmName; hash: string } { return { name, hash }; }
const names: readonly RsaAlgorithmName[] = ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"];
const hashes = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

for (const name of names) {
  for (const hash of hashes) {
    const suffix = hash === "SHA-1" ? "1" : hash.slice(4);
    const jwkAlg = name === "RSA-OAEP" ? (hash === "SHA-1" ? "RSA-OAEP" : "RSA-OAEP-" + suffix)
      : (name === "RSA-PSS" ? "PS" : "RS") + suffix;
    test(name + " / " + hash + " imports and exports SPKI, PKCS8 and JWK", async () => {
      const f = fixture();
      for (const type of ["public", "private"] as const) {
        const format = type === "public" ? "spki" : "pkcs8";
        const encoded = type === "public" ? rsaSpki() : rsaPkcs8();
        const usages = name === "RSA-OAEP" ? (type === "public" ? ["wrapKey", "encrypt", "encrypt"] : ["unwrapKey", "decrypt", "decrypt"])
          : [type === "public" ? "verify" : "sign"];
        const key = await f.settle(f.subtle.importKey(format, encoded, alg(name, hash), true, usages));
        assert.equal(key.type, type);
        assert.equal(key.extractable, true);
        assert.deepEqual(key.algorithm, { name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: hash } });
        assert.deepEqual(Object.keys(key.algorithm), ["name", "modulusLength", "publicExponent", "hash"]);
        assert.equal(f.provider.importInput?.format, format);
        if (f.provider.importInput?.format === format) assert.equal(f.provider.importInput.bytes, encoded, "whole DER is borrowed synchronously");
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey(format, key))), encoded);
        const exported = jwk(await f.settle(f.subtle.exportKey("jwk", key)));
        assert.deepEqual(exported, { ...(type === "public" ? rsaPublicJwk() : rsaPrivateJwk()), alg: jwkAlg, ext: true, key_ops: key.usages });
        const fromJwk = await f.settle(f.subtle.importKey("jwk", exported, alg(name, hash), false, key.usages));
        assert.equal(fromJwk.extractable, false);
        assert.equal(fromJwk.type, type);
        assert.deepEqual(fromJwk.algorithm, key.algorithm);
        await assert.rejects(f.settle(f.subtle.exportKey(format, fromJwk)), dom("InvalidAccessError"));
      }
      assert.equal(f.provider.imports, 4);
      assert.equal(f.provider.exports, 2);
      assert.equal(f.provider.componentExports, 2);
    });

    test(name + " / " + hash + " generates a pair with split usages and independent cached algorithms", async () => {
      const f = fixture();
      const exponent = new Uint8Array([0, 0, 1, 0, 1]);
      const usages: KeyUsage[] = name === "RSA-OAEP" ? ["unwrapKey", "encrypt", "decrypt", "wrapKey", "encrypt"] : ["verify", "sign", "verify"];
      const result = pair(await f.settle(f.subtle.generateKey({ ...alg(name, hash), modulusLength: 512, publicExponent: exponent }, false, usages)));
      assert.deepEqual(Object.keys(result), ["privateKey", "publicKey"]);
      assert.equal(result.publicKey.type, "public");
      assert.equal(result.privateKey.type, "private");
      assert.equal(result.publicKey.extractable, true);
      assert.equal(result.privateKey.extractable, false);
      assert.deepEqual(result.publicKey.usages, name === "RSA-OAEP" ? ["encrypt", "wrapKey"] : ["verify"]);
      assert.deepEqual(result.privateKey.usages, name === "RSA-OAEP" ? ["decrypt", "unwrapKey"] : ["sign"]);
      assert.deepEqual(result.publicKey.algorithm, { name, modulusLength: 512, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: hash } });
      assert.deepEqual(result.privateKey.algorithm, result.publicKey.algorithm);
      assert.equal(result.publicKey.algorithm, result.publicKey.algorithm);
      assert.notEqual(result.publicKey.algorithm, result.privateKey.algorithm);
      const publicAlgorithm = result.publicKey.algorithm as { name: string; modulusLength: number; publicExponent: Uint8Array; hash: { name: string } };
      const privateAlgorithm = result.privateKey.algorithm as typeof publicAlgorithm;
      assert.notEqual(publicAlgorithm.publicExponent, privateAlgorithm.publicExponent);
      assert.notEqual(publicAlgorithm.hash, privateAlgorithm.hash);
      exponent.fill(0);
      publicAlgorithm.publicExponent.fill(0);
      publicAlgorithm.hash.name = "SHA-1";
      publicAlgorithm.modulusLength = 1;
      assert.deepEqual(privateAlgorithm.publicExponent, new Uint8Array([1, 0, 1]));
      assert.equal(privateAlgorithm.hash.name, hash);
      assert.equal(privateAlgorithm.modulusLength, 512);
      assert.equal(f.fills(), 0, "asymmetric generation uses native secure randomness");
      assert.equal(f.provider.generations, 1);
      assert.equal(f.provider.imports, 0);
      assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", result.publicKey))).e, "AQAB");
      assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", result.publicKey))).alg, jwkAlg);
      assert.equal(buffer(await f.settle(f.subtle.exportKey("spki", result.publicKey))).length > 0, true);
      await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", result.privateKey)), dom("InvalidAccessError"));
    });
  }
}

test("RSA generation validates public exponent bounds before one native call", async () => {
  const f = fixture();
  f.provider.generationFailure = { failure: "operation" };
  const invalid: readonly [number, readonly number[]][] = [
    [0, [3]], [3, [3]], [4, []], [4, [0]], [4, [1]], [4, [2]], [4, [4]],
    [4, [15]], [4, [17]], [8, [255]], [8, [1, 0, 1]], [9, [1, 255]], [9, [2, 1]],
    [512, [0, 0, 2]], [512, [0, 0, 0]],
  ];
  for (const [modulusLength, publicExponent] of invalid) {
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "RSA-PSS", modulusLength, publicExponent: new Uint8Array(publicExponent), hash: "SHA-256" }, true, ["sign"])), dom("OperationError"));
  }
  assert.equal(f.provider.generations, 0);
  for (const [modulusLength, publicExponent] of [[4, [3]], [4, [13]], [8, [253]], [9, [1, 253]], [512, [0, 0, 1, 0, 1]]] as const) {
    const before: number = f.provider.generations;
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "RSA-PSS", modulusLength, publicExponent: new Uint8Array(publicExponent), hash: "SHA-256" }, true, ["sign"])), dom("OperationError"));
    assert.equal(f.provider.generations, before + 1, "valid bounds reach the native generator");
  }
});

for (const name of names) {
  test(name + " generation validates usages before bounds and private usage after native generation", async () => {
    const f = fixture();
    const parameters = { name, modulusLength: 0, publicExponent: new Uint8Array(), hash: "SHA-256" };
    await assert.rejects(f.settle(f.subtle.generateKey(parameters, true, ["deriveBits"])), dom("SyntaxError"));
    assert.equal(f.provider.generations, 0);
    const valid = { ...parameters, modulusLength: 512, publicExponent: new Uint8Array([1, 0, 1]) };
    for (const usages of [[], name === "RSA-OAEP" ? ["encrypt", "wrapKey"] : ["verify"]]) {
      const before: number = f.provider.generations;
      await assert.rejects(f.settle(f.subtle.generateKey(valid, true, usages)), dom("SyntaxError"));
      assert.equal(f.provider.generations, before + 1);
    }
    const result = pair(await f.settle(f.subtle.generateKey(valid, true, name === "RSA-OAEP" ? ["decrypt"] : ["sign"])));
    assert.deepEqual(result.publicKey.usages, []);
    assert.equal(result.privateKey.usages.length, 1);
    assert.equal(result.privateKey.extractable, true);
  });

  test(name + " import enforces public/private usages before malformed key data", async () => {
    const f = fixture();
    for (const format of ["spki", "pkcs8"] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), alg(name), true, ["deriveBits"])), dom("SyntaxError"));
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), alg(name), true, [])), dom("DataError"));
    }
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { kty: "wrong", d: "" }, alg(name), true, ["verify"])), dom("SyntaxError"));
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), alg(name), true, ["deriveBits"])), dom("NotSupportedError"));
    assert.equal(f.provider.imports, 0);
    const publicKey = await f.settle(f.subtle.importKey("spki", rsaSpki(), alg(name), false, []));
    assert.equal(publicKey.type, "public");
    assert.equal(publicKey.extractable, false);
    assert.deepEqual(publicKey.usages, []);
    const before = f.provider.imports;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", rsaPkcs8(), alg(name), true, [])), dom("SyntaxError"));
    assert.equal(f.provider.imports, before + 1);
  });
}

test("RSA imports reject JWK policy errors before native decoding", async () => {
  const f = fixture();
  const invalid: readonly JsonWebKeyObject[] = [
    { ...rsaPublicJwk(), kty: "rsa" }, { ...rsaPublicJwk(), kty: "EC" },
    { ...rsaPublicJwk(), use: "enc" }, { ...rsaPublicJwk(), use: "SIG" },
    { ...rsaPublicJwk(), key_ops: ["verify", "verify"] },
    { ...rsaPublicJwk(), key_ops: ["unknown", "unknown", "verify"] },
    { ...rsaPublicJwk(), key_ops: ["sign"] },
    { ...rsaPublicJwk(), use: "sig", key_ops: ["verify", "encrypt"] },
    { ...rsaPublicJwk(), ext: false },
    { ...rsaPublicJwk(), alg: "PS256" }, { ...rsaPublicJwk(), alg: "RS1" },
    { ...rsaPublicJwk(), alg: "rs256" }, { ...rsaPublicJwk(), alg: "RS128" },
  ];
  for (const data of invalid) await assert.rejects(f.settle(f.subtle.importKey("jwk", data, alg("RSASSA-PKCS1-v1_5"), true, ["verify"])), dom("DataError"));
  assert.equal(f.provider.imports, 0);
  const accepted = await f.settle(f.subtle.importKey("jwk", { ...rsaPublicJwk(), key_ops: ["unknown", "verify"], ext: false }, alg("RSASSA-PKCS1-v1_5"), false, ["verify"]));
  assert.deepEqual(accepted.usages, ["verify"]);
  const empty = await f.settle(f.subtle.importKey("jwk", { ...rsaPublicJwk(), use: "arbitrary", key_ops: [] }, alg("RSASSA-PKCS1-v1_5"), true, []));
  assert.deepEqual(empty.usages, []);
});

test("RSA JWK Base64urlUInt members reject missing, empty, zero, leading-zero and invalid encodings", async () => {
  const f = fixture();
  for (const member of ["n", "e", "d", "p", "q", "dp", "dq", "qi"] as const) {
    for (const value of [undefined, "", "AA", "AAE", "AQ==", "AQ+_", "A", " AQ"]) {
      const data: JsonWebKeyObject = { ...rsaPrivateJwk() };
      if (value === undefined) delete data[member];
      else data[member] = value;
      // Removing d makes this a public key; public-key import ignores private fields.
      if (member === "d" && value === undefined) continue;
      await assert.rejects(f.settle(f.subtle.importKey("jwk", data, alg("RSA-PSS"), true, ["sign"])), dom("DataError"), member + "=" + value);
    }
  }
  assert.equal(f.provider.imports, 0);
  for (const [n, e] of [["Aw", "Aw"], ["OA", "Aw"], ["Nw", "AQ"], ["Nw", "Ag"], ["Nw", "BA"], ["Nw", "Nw"], ["Nw", "OQ"]]) {
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { kty: "RSA", n, e }, alg("RSA-PSS"), true, ["verify"])), dom("DataError"));
  }
  assert.equal(f.provider.imports, 0);
});

test("RSA private JWK requires all optional CRT parameters together and complete nonempty oth", async () => {
  const f = fixture();
  const minimal = { kty: "RSA", n: rsaPrivateJwk().n, e: rsaPrivateJwk().e, d: rsaPrivateJwk().d };
  for (const field of ["p", "q", "dp", "dq", "qi"] as const) {
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...minimal, [field]: rsaPrivateJwk()[field] }, alg("RSA-PSS"), true, ["sign"])), dom("DataError"));
  }
  for (const oth of [[], [{}], [{ r: "Bw" }], [{ r: "Bw", d: "BQ" }], [{ r: "Bw", d: "BQ", t: "" }], [{ r: "Bw", d: "BQ", t: "AAE" }]]) {
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...rsaPrivateJwk(), oth }, alg("RSA-PSS"), true, ["sign"])), dom("DataError"));
  }
  assert.equal(f.provider.imports, 0);
});

test("RSA shared import passes valid n/e/d-only and multi-prime shapes to the native capability", async () => {
  // This recording provider deliberately stands in for a native implementation
  // supporting these representations. Node's primitive adapter cannot recover
  // missing CRT factors or export multi-prime JWK components; its limitation is
  // separately tested, never imposed by shared Web Crypto format policy.
  const f = fixture();
  const underlying = new NodeCryptoProvider().importKey({ format: "pkcs8", bytes: rsaPkcs8() });
  assert.ok(!("failure" in underlying));
  f.provider.importRecord = underlying;
  const original = rsaPrivateJwk();
  const minimal = { kty: "RSA", n: original.n, e: original.e, d: original.d };
  const key = await f.settle(f.subtle.importKey("jwk", minimal, alg("RSA-PSS"), true, ["sign"]));
  assert.equal(key.type, "private");
  assert.equal(f.provider.importInput?.format, "components");
  if (f.provider.importInput?.format !== "components" || f.provider.importInput.components.family !== "RSA") assert.fail("RSA components expected");
  const components = f.provider.importInput.components;
  assert.deepEqual(Object.keys(components), ["family", "n", "e", "d"]);
  assert.equal(Buffer.from(components.d!).toString("base64url"), original.d);
  await f.settle(f.subtle.importKey("jwk", { ...original, oth: [{ r: "Bw", d: "BQ", t: "AQ" }] }, alg("RSA-PSS"), true, ["sign"]));
  const input = f.provider.importInput as CryptoKeyImport;
  assert.ok(input.format === "components" && input.components.family === "RSA");
  assert.deepEqual(input.components.oth, [{ r: new Uint8Array([7]), d: new Uint8Array([5]), t: new Uint8Array([1]) }]);
});

test("RSA public JWK imports ignore private-only fields when d is absent", async () => {
  const f = fixture();
  const key = await f.settle(f.subtle.importKey("jwk", { ...rsaPublicJwk(), p: "!", q: "!", dp: "!", dq: "!", qi: "!", oth: [{}] }, alg("RSA-PSS"), true, ["verify"]));
  assert.equal(key.type, "public");
  const input = f.provider.importInput;
  assert.ok(input?.format === "components" && input.components.family === "RSA");
  assert.deepEqual(Object.keys(input.components), ["family", "n", "e"]);
});

for (const failure of ["invalid-key", "operation"] as const) {
  test("RSA maps native " + failure + " results at import, generate and export boundaries", async () => {
    const f = fixture();
    f.provider.importFailure = { failure };
    for (const [format, data] of [["spki", rsaSpki()], ["jwk", rsaPublicJwk()]] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, data, alg("RSA-PSS"), true, ["verify"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    f.provider.importFailure = undefined;
    const key = await f.imported("public");
    f.provider.exportFailure = { failure };
    for (const format of ["raw", "spki", "pkcs8", "jwk"]) {
      await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
    }
    f.provider.generationFailure = { failure };
    await assert.rejects(f.settle(f.subtle.generateKey({ name: "RSA-PSS", hash: "SHA-256", modulusLength: 512, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign"])), dom("OperationError"));
  });
}

test("RSA exports check extractability, material access, format and type in order", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  const restricted = await f.imported("private", "RSA-PSS", false);
  for (const format of ["raw", "pkcs8", "spki", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, restricted)), dom("InvalidAccessError"));
  assert.equal(f.provider.exports, 0);
  assert.equal(f.provider.componentExports, 0);
  await assert.rejects(f.settle(f.subtle.exportKey("raw", publicKey)), dom("NotSupportedError"));
  assert.equal(f.provider.exportFormat, "spki");
  await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", publicKey)), dom("InvalidAccessError"));
  assert.equal(f.provider.exportFormat, "spki");
  await assert.rejects(f.settle(f.subtle.exportKey("spki", privateKey)), dom("InvalidAccessError"));
  assert.equal(f.provider.exportFormat, "pkcs8");
  assert.equal(f.provider.exports, 3);
});

test("RSA rejects inconsistent native import/generation metadata", async () => {
  const underlying = new NodeCryptoProvider().importKey({ format: "spki", bytes: rsaSpki() });
  assert.ok(!("failure" in underlying));
  const f = fixture();
  for (const info of [
    { family: "secret", type: "secret", length: 2048 } as const,
    { family: "RSA", type: "private", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const,
    { family: "RSA", type: "public", modulusLength: 2047, publicExponent: new Uint8Array([1, 0, 1]) } as const,
    { family: "RSA", type: "public", modulusLength: 2048, publicExponent: new Uint8Array([3]) } as const,
    { family: "RSA", type: "public", modulusLength: 2048, publicExponent: new Uint8Array([0, 1, 0, 1]) } as const,
  ]) {
    f.provider.importRecord = { handle: underlying.handle, info };
    await assert.rejects(f.settle(f.subtle.importKey("spki", rsaSpki(), alg("RSA-PSS"), true, ["verify"])), dom("OperationError"));
  }
  class WrongGeneration extends RecordingProvider {
    override generateKeyPair(): CryptoKeyPairRecord {
      return { publicKey: underlying as CryptoKeyRecord, privateKey: underlying as CryptoKeyRecord };
    }
  }
  const g = fixture(new WrongGeneration());
  await assert.rejects(g.settle(g.subtle.generateKey({ name: "RSA-PSS", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign"])), dom("OperationError"));
});

test("RSA exports reject invalid native DER/components and isolate every output", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  const first = buffer(await f.settle(f.subtle.exportKey("spki", publicKey)));
  const second = buffer(await f.settle(f.subtle.exportKey("spki", publicKey)));
  assert.notEqual(first.buffer, second.buffer);
  first.fill(0);
  assert.deepEqual(second, rsaSpki());
  const dictionary = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  dictionary.key_ops!.push("verify");
  dictionary.n = "AA";
  const next = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  assert.equal(next.n, rsaPrivateJwk().n);
  assert.deepEqual(next.key_ops, ["sign"]);
  f.provider.exportBytes = new Uint8Array([0x30, 0]);
  await assert.rejects(f.settle(f.subtle.exportKey("spki", publicKey)), dom("OperationError"));
  f.provider.exportBytes = undefined;
  f.provider.exportParts = { family: "secret", k: new Uint8Array([1]) };
  await assert.rejects(f.settle(f.subtle.exportKey("jwk", publicKey)), dom("OperationError"));
  f.provider.exportParts = { family: "RSA", n: new Uint8Array([55]), e: new Uint8Array([3]) };
  await assert.rejects(f.settle(f.subtle.exportKey("jwk", publicKey)), dom("OperationError"));
  const native = new NodeCryptoProvider().exportComponents(getCryptoKeySlots(privateKey).handle);
  assert.ok(!("failure" in native) && native.family === "RSA");
  f.provider.exportParts = { family: "RSA", n: native.n, e: native.e, d: native.d };
  await assert.rejects(f.settle(f.subtle.exportKey("jwk", privateKey)), dom("OperationError"));
});

test("RSA multi-prime component export produces complete, independent oth dictionaries", async () => {
  const f = fixture();
  const privateKey = await f.imported("private");
  const native = new NodeCryptoProvider().exportComponents(getCryptoKeySlots(privateKey).handle);
  assert.ok(!("failure" in native) && native.family === "RSA");
  const supplied: CryptoRsaComponents = { ...native, oth: [{ r: new Uint8Array([7]), d: new Uint8Array([5]), t: new Uint8Array([1]) }] };
  f.provider.exportParts = supplied;
  const exported = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  assert.deepEqual(exported.oth, [{ d: "BQ", r: "Bw", t: "AQ" }]);
  assert.deepEqual(Object.keys(exported.oth![0]!), ["d", "r", "t"]);
  exported.oth![0]!.r = "AA";
  assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", privateKey))).oth, [{ d: "BQ", r: "Bw", t: "AQ" }]);
});

test("RSA key operations run synchronously and settle through exactly one queued crypto task", async () => {
  const f = fixture();
  const input = rsaSpki();
  const promise = f.subtle.importKey("spki", input, alg("RSA-PSS"), true, ["verify"]);
  assert.equal(f.provider.imports, 1);
  input.fill(0);
  let settled = false;
  void promise.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  const key = await f.settle(promise);
  assert.equal(key.type, "public");
  assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).n, rsaPublicJwk().n);
  const before = f.provider.imports;
  const malformed = f.subtle.importKey("spki", new Uint8Array(), alg("RSA-PSS"), true, ["verify"]);
  assert.equal(f.provider.imports, before, "shared DER policy fails before native import");
  await assert.rejects(f.settle(malformed), dom("DataError"));
});

test("RSA imports SPKI and PKCS8 with omitted parameters, then exports canonical NULL parameters", async () => {
  const algorithm = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0]);
  for (const format of ["spki", "pkcs8"] as const) {
    const f = fixture();
    const original = format === "spki" ? rsaSpki() : rsaPkcs8();
    const start = Buffer.from(original).indexOf(Buffer.from(algorithm));
    assert.ok(start >= 0);
    const omitted = new Uint8Array(original.length - 2);
    omitted.set(original.subarray(0, start + 13));
    omitted.set(original.subarray(start + 15), start + 13);
    omitted[start + 1] = 11;
    assert.equal(omitted[1], 0x82);
    const outerLength = (omitted[2]! * 256 + omitted[3]!) - 2;
    omitted[2] = outerLength >>> 8;
    omitted[3] = outerLength & 255;
    const key = await f.settle(f.subtle.importKey(format, omitted, alg("RSA-PSS"), true, [format === "spki" ? "verify" : "sign"]));
    assert.deepEqual(buffer(await f.settle(f.subtle.exportKey(format, key))), original);
    assert.equal(f.provider.imports, 1);
    const nonNull = original.slice(); nonNull[start + 13] = 4;
    await assert.rejects(f.settle(f.subtle.importKey(format, nonNull, alg("RSA-PSS"), true, [format === "spki" ? "verify" : "sign"])), dom("DataError"));
    assert.equal(f.provider.imports, 1, "non-NULL parameters rejected by shared policy");
  }
});
