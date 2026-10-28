// Specification controls: Web Cryptography §§9, 13–17, 25.3.3–5, 26.3.2–4;
// RFC 8410 §§3–4, 7, RFC 8037 §2 and RFC 7517 §4. No Node WebCrypto.
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type {
  CryptoFailure, CryptoKeyComponents, CryptoKeyHandle, CryptoKeyImport,
  CryptoKeyPairGeneration, CryptoKeyPairRecord, CryptoKeyRecord, CryptoOkpComponents,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { okpPkcs8, okpPrivateJwk, okpPublicJwk, okpRawPublic, okpSpki } from "./okp-fixtures.ts";
import type { OkpFixtureName } from "./okp-fixtures.ts";

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
    this.imports++; this.importInput = input;
    return this.importFailure ?? this.importRecord ?? super.importKey(input);
  }
  override exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    this.exports++; this.exportFormat = format;
    return this.exportFailure ?? this.exportBytes ?? super.exportKey(key, format);
  }
  override exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure {
    this.componentExports++;
    return this.exportFailure ?? this.exportParts ?? super.exportComponents(key);
  }
  override generateKeyPair(parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure {
    this.generations++; this.generationInput = parameters;
    return this.generationFailure ?? this.generationRecord ?? super.generateKeyPair(parameters);
  }
}

function usagesFor(name: OkpFixtureName, type: "public" | "private"): KeyUsage[] {
  return name === "Ed25519" ? [type === "public" ? "verify" : "sign"] : type === "private" ? ["deriveKey", "deriveBits"] : [];
}
function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  let fills = 0;
  const subtle = createCrypto({ fill(bytes) { fills++; bytes.fill(0x37); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function imported(type: "public" | "private", name: OkpFixtureName = "Ed25519", extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey(type === "public" ? "spki" : "pkcs8", type === "public" ? okpSpki(name) : okpPkcs8(name), name, extractable, usagesFor(name, type)));
  }
  return { provider, scheduler, subtle, settle, imported, fills: () => fills };
}
function dom(name: string): (error: unknown) => boolean { return error => error instanceof DOMException && error.name === name; }
function pair(result: CryptoKey | CryptoKeyPair): CryptoKeyPair { assert.ok("privateKey" in result && "publicKey" in result); return result; }
function jwk(result: ArrayBuffer | JsonWebKeyObject): JsonWebKeyObject { assert.ok(!(result instanceof ArrayBuffer)); return result; }
function buffer(result: ArrayBuffer | JsonWebKeyObject): Uint8Array { assert.ok(result instanceof ArrayBuffer); return new Uint8Array(result); }
function parts(name: OkpFixtureName, value: JsonWebKeyObject): CryptoOkpComponents {
  const x = new Uint8Array(Buffer.from(value.x!, "base64url"));
  return value.d === undefined ? { family: "OKP", namedCurve: name, x }
    : { family: "OKP", namedCurve: name, x, d: new Uint8Array(Buffer.from(value.d, "base64url")) };
}
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = Buffer.concat(parts);
  assert.ok(value.length < 128);
  return new Uint8Array(Buffer.concat([Buffer.from([tag, value.length]), value]));
}
function publicDer(name: OkpFixtureName, x: Uint8Array): Uint8Array {
  return der(0x30, der(0x30, der(6, new Uint8Array([0x2b, 0x65, name === "Ed25519" ? 0x70 : 0x6e]))), der(3, new Uint8Array([0]), x));
}
function privateDer(name: OkpFixtureName, d: Uint8Array): Uint8Array {
  return der(0x30, der(2, new Uint8Array([0])), der(0x30, der(6, new Uint8Array([0x2b, 0x65, name === "Ed25519" ? 0x70 : 0x6e]))), der(4, der(4, d)));
}
const names: readonly OkpFixtureName[] = ["Ed25519", "X25519"];

for (const name of names) {
  test(name + " imports and exports all allowed formats with name-only metadata", async () => {
    const f = fixture();
    for (const format of ["raw", "spki", "jwk"] as const) {
      const data = format === "raw" ? okpRawPublic(name) : format === "spki" ? okpSpki(name) : okpPublicJwk(name);
      const usages = usagesFor(name, "public");
      const key = await f.settle(f.subtle.importKey(format, data, name, true, usages));
      assert.equal(key.type, "public");
      assert.equal(key.extractable, true);
      assert.deepEqual(key.algorithm, { name });
      assert.deepEqual(Object.keys(key.algorithm), ["name"]);
      assert.deepEqual(key.usages, usages);
      const input = f.provider.importInput;
      assert.ok(input !== undefined);
      if (input.format === "raw" || input.format === "spki") assert.equal(input.bytes, data);
      else assert.ok(input.format === "components" && input.components.family === "OKP");
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("raw", key))), okpRawPublic(name));
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("spki", key))), okpSpki(name));
      const expected = { ...okpPublicJwk(name), ...(name === "Ed25519" ? { alg: "Ed25519" } : {}), ext: true, key_ops: usages };
      assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", key))), expected);
    }
    for (const format of ["pkcs8", "jwk"] as const) {
      const key = await f.settle(f.subtle.importKey(format, format === "pkcs8" ? okpPkcs8(name) : okpPrivateJwk(name), name, true, usagesFor(name, "private")));
      assert.equal(key.type, "private");
      assert.deepEqual(key.algorithm, { name });
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), okpPkcs8(name));
      const exported = jwk(await f.settle(f.subtle.exportKey("jwk", key)));
      assert.deepEqual(exported, { ...okpPrivateJwk(name), ...(name === "Ed25519" ? { alg: "Ed25519" } : {}), ext: true, key_ops: usagesFor(name, "private") });
      const restricted = await f.settle(f.subtle.importKey("jwk", exported, name, false, usagesFor(name, "private")));
      assert.equal(restricted.extractable, false);
      await assert.rejects(f.settle(f.subtle.exportKey("jwk", restricted)), dom("InvalidAccessError"));
    }
    assert.equal(f.provider.imports, 7);
    assert.equal(f.fills(), 0);
  });

  test(name + " generation splits usages and isolates cached metadata", async () => {
    const f = fixture();
    const usages = name === "Ed25519" ? ["verify", "sign", "verify"] : ["deriveBits", "deriveKey", "deriveBits"];
    const generated = pair(await f.settle(f.subtle.generateKey(name, false, usages)));
    assert.deepEqual(Object.keys(generated), ["privateKey", "publicKey"]);
    assert.equal(generated.publicKey.extractable, true);
    assert.equal(generated.privateKey.extractable, false);
    assert.deepEqual(generated.publicKey.usages, usagesFor(name, "public"));
    assert.deepEqual(generated.privateKey.usages, usagesFor(name, "private"));
    assert.deepEqual(generated.publicKey.algorithm, { name });
    assert.deepEqual(generated.privateKey.algorithm, { name });
    assert.notEqual(generated.publicKey.algorithm, generated.privateKey.algorithm);
    assert.equal(generated.publicKey.algorithm, generated.publicKey.algorithm);
    const publicAlgorithm = generated.publicKey.algorithm as { name: string };
    publicAlgorithm.name = "changed";
    generated.publicKey.usages.push("encrypt");
    const exported = jwk(await f.settle(f.subtle.exportKey("jwk", generated.publicKey)));
    assert.equal(exported.crv, name);
    assert.deepEqual(exported.key_ops, usagesFor(name, "public"));
    assert.deepEqual(generated.privateKey.algorithm, { name });
    assert.equal(f.provider.generations, 1);
    assert.deepEqual(f.provider.generationInput, { family: "OKP", namedCurve: name });
    assert.equal(f.fills(), 0);
  });

  test(name + " generation checks usages before native work and empty private usages afterwards", async () => {
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, ["encrypt"])), dom("SyntaxError"));
    assert.equal(f.provider.generations, 0);
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.generations, 1);
    if (name === "Ed25519") {
      await assert.rejects(f.settle(f.subtle.generateKey(name, true, ["verify"])), dom("SyntaxError"));
      assert.equal(f.provider.generations, 2);
    }
  });

  test(name + " import validates usages before encoding and empty private usages last", async () => {
    const f = fixture();
    for (const format of ["raw", "spki", "pkcs8"] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), name, true, ["encrypt"])), dom("SyntaxError"));
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), name, true, [])), dom("DataError"));
    }
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { kty: "wrong", d: "" }, name, true, ["verify"])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 0);
    const publicKey = await f.settle(f.subtle.importKey("raw", okpRawPublic(name), name, false, []));
    assert.equal(publicKey.type, "public");
    assert.equal(publicKey.extractable, false);
    assert.deepEqual(publicKey.usages, []);
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", okpPkcs8(name), name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 2);
    assert.equal(f.provider.componentExports, 0, "PKCS8 has no redundant public key to inspect");
    await assert.rejects(f.settle(f.subtle.importKey("jwk", okpPrivateJwk(name), name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.componentExports, 1, "JWK consistency precedes the empty-private-usage check");
  });

  test(name + " public import retains opaque values across raw, SPKI and JWK", async () => {
    const f = fixture();
    const prime = new Uint8Array(32).fill(0xff); prime[0] = 0xed; prime[31] = 0x7f;
    const values = [new Uint8Array(32), new Uint8Array(32).fill(0xff), prime, new Uint8Array(32).fill(0x80)];
    for (const x of values) {
      for (const format of ["raw", "spki", "jwk"] as const) {
        const data = format === "raw" ? x : format === "spki" ? publicDer(name, x) : { kty: "OKP", crv: name, x: Buffer.from(x).toString("base64url") };
        const key = await f.settle(f.subtle.importKey(format, data, name, true, usagesFor(name, "public")));
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("raw", key))), x);
        assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).x, Buffer.from(x).toString("base64url"));
      }
    }
    assert.equal(f.provider.imports, 12, "public point validity is deliberately not an import requirement");
  });

  test(name + " raw public keys require exactly 32 octets", async () => {
    const f = fixture();
    for (const length of [0, 1, 31, 33, 64]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(length), name, true, usagesFor(name, "public"))), dom("DataError"));
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " rejects original DER trailing data that native decoders accept", async () => {
    const f = fixture();
    for (const format of ["spki", "pkcs8"] as const) {
      const original = format === "spki" ? okpSpki(name) : okpPkcs8(name);
      const encoded = new Uint8Array(Buffer.concat([original, Buffer.from([0])]));
      const native = new NodeCryptoProvider().importKey({ format, bytes: encoded });
      assert.ok(!("failure" in native), "control: native parsing ignores the trailing octet");
      await assert.rejects(f.settle(f.subtle.importKey(format, encoded, name, true, usagesFor(name, format === "spki" ? "public" : "private"))), dom("DataError"));
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " JWK checks kty, crv, use, key_ops and ext before native work", async () => {
    const f = fixture();
    const usages = usagesFor(name, "private");
    const allowed = usages[0]!;
    for (const data of [
      { ...okpPrivateJwk(name), kty: "EC" }, { ...okpPrivateJwk(name), kty: "okp" },
      { ...okpPrivateJwk(name), crv: name.toLowerCase() }, { ...okpPrivateJwk(name), crv: undefined },
      { ...okpPrivateJwk(name), use: name === "Ed25519" ? "enc" : "sig" },
      { ...okpPrivateJwk(name), use: "other" }, { ...okpPrivateJwk(name), key_ops: [allowed, allowed] },
      { ...okpPrivateJwk(name), key_ops: ["unknown", "unknown", ...usages] },
      { ...okpPrivateJwk(name), key_ops: [] },
      { ...okpPrivateJwk(name), use: "sig", key_ops: ["sign", "deriveKey", "deriveBits"] },
      { ...okpPrivateJwk(name), use: "enc", key_ops: ["sign", "deriveKey", "deriveBits"] },
      { ...okpPrivateJwk(name), ext: false },
    ]) await assert.rejects(f.settle(f.subtle.importKey("jwk", data, name, true, usages)), dom("DataError"));
    assert.equal(f.provider.imports, 0);
    const accepted = await f.settle(f.subtle.importKey("jwk", { ...okpPrivateJwk(name), key_ops: ["unknown", ...usages], ext: false }, name, false, usages));
    assert.deepEqual(accepted.usages, usages);
    const empty = await f.settle(f.subtle.importKey("jwk", { ...okpPublicJwk(name), use: "arbitrary", key_ops: [] }, name, true, []));
    assert.deepEqual(empty.usages, []);
  });

  test(name + " JWK requires full-width unpadded x and private d", async () => {
    const f = fixture();
    for (const member of ["x", "d"] as const) {
      const original = okpPrivateJwk(name);
      const octets = Buffer.from(original[member], "base64url");
      for (const value of [undefined, "", "AA", octets.subarray(1).toString("base64url"), Buffer.concat([Buffer.from([0]), octets]).toString("base64url"), original[member] + "=", "!", "A"]) {
        if (member === "d" && value === undefined) continue;
        await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...original, [member]: value }, name, true, usagesFor(name, "private"))), dom("DataError"));
      }
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " private JWK public bytes must match the actual seed-derived public key", async () => {
    const original = okpPrivateJwk(name);
    const altered = new Uint8Array(Buffer.from(original.x, "base64url")); altered[0]! ^= 1;
    const supplied = { ...original, x: Buffer.from(altered).toString("base64url") };
    const native = new NodeCryptoProvider();
    const accepted = native.importKey({ format: "components", components: parts(name, supplied) });
    assert.ok(!("failure" in accepted), "control: native import constructs the key represented by d");
    const actual = native.exportComponents(accepted.handle);
    assert.ok(!("failure" in actual) && actual.family === "OKP");
    assert.equal(Buffer.from(actual.x).toString("base64url"), original.x);
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("jwk", supplied, name, true, usagesFor(name, "private"))), dom("DataError"));
    assert.equal(f.provider.imports, 1);
    assert.equal(f.provider.componentExports, 1);
    await assert.rejects(f.settle(f.subtle.importKey("jwk", supplied, name, true, [])), dom("DataError"));
  });

  test(name + " private seed bytes are preserved without EC scalar range restrictions", async () => {
    const f = fixture();
    for (const d of [new Uint8Array(32), new Uint8Array(32).fill(0xff)]) {
      const encoded = privateDer(name, d);
      const native = createPrivateKey({ key: Buffer.from(encoded), format: "der", type: "pkcs8" });
      const x = createPublicKey(native).export({ format: "jwk" }).x!;
      const data = { kty: "OKP", crv: name, x, d: Buffer.from(d).toString("base64url") };
      const imported = await f.settle(f.subtle.importKey("jwk", data, name, true, usagesFor(name, "private")));
      assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", imported))).d, data.d);
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", imported))), encoded);
    }
  });
}

test("Ed25519 accepts Ed25519 and legacy EdDSA JWK alg, exports the fully specified name", async () => {
  const f = fixture();
  for (const alg of [undefined, "Ed25519", "EdDSA"]) {
    const key = await f.settle(f.subtle.importKey("jwk", { ...okpPublicJwk("Ed25519"), alg }, "Ed25519", true, ["verify"]));
    assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).alg, "Ed25519");
  }
  for (const alg of ["ed25519", "eddsa", "Ed448", "ES256", "", "X25519"]) {
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...okpPublicJwk("Ed25519"), alg }, "Ed25519", true, ["verify"])), dom("DataError"));
  }
});

test("X25519 ignores JWK alg and does not emit alg on export", async () => {
  const f = fixture();
  for (const alg of [undefined, "X25519", "ECDH-ES", "Ed25519", "", "unknown"]) {
    const key = await f.settle(f.subtle.importKey("jwk", { ...okpPublicJwk("X25519"), alg }, "X25519", true, []));
    assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).alg, undefined);
  }
});

test("OKP DER algorithm mismatch fails before native import", async () => {
  const f = fixture();
  for (const name of names) {
    const other = name === "Ed25519" ? "X25519" : "Ed25519";
    for (const format of ["spki", "pkcs8"] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, format === "spki" ? okpSpki(other) : okpPkcs8(other), name, true, usagesFor(name, format === "spki" ? "public" : "private"))), dom("DataError"));
    }
  }
  assert.equal(f.provider.imports, 0);
});

test("OKP JWK ignores unrelated y and private-family fields", async () => {
  const f = fixture();
  for (const name of names) {
    const key = await f.settle(f.subtle.importKey("jwk", { ...okpPublicJwk(name), y: "!", p: "!", q: "!", k: "!", oth: [{}] }, name, true, usagesFor(name, "public")));
    assert.equal(key.type, "public");
    const input = f.provider.importInput;
    assert.ok(input?.format === "components" && input.components.family === "OKP");
    assert.deepEqual(Object.keys(input.components), ["family", "namedCurve", "x"]);
  }
});

for (const failure of ["invalid-key", "operation"] as const) {
  test("OKP maps native " + failure + " failures at import, generate, inspection and export boundaries", async () => {
    const f = fixture();
    f.provider.importFailure = { failure };
    for (const [format, data] of [["raw", okpRawPublic("Ed25519")], ["spki", okpSpki("Ed25519")], ["jwk", okpPublicJwk("Ed25519")]] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, data, "Ed25519", true, ["verify"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    f.provider.importFailure = undefined;
    const key = await f.imported("public");
    f.provider.exportFailure = { failure };
    for (const format of ["raw", "spki", "pkcs8", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.importKey("jwk", okpPrivateJwk("Ed25519"), "Ed25519", true, ["sign"])), dom("OperationError"));
    f.provider.generationFailure = { failure };
    await assert.rejects(f.settle(f.subtle.generateKey("Ed25519", true, ["sign"])), dom("OperationError"));
  });
}

test("OKP export checks extractability, material access and key type in order", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  const restricted = await f.imported("private", "Ed25519", false);
  for (const format of ["raw", "spki", "pkcs8", "jwk"]) await assert.rejects(f.settle(f.subtle.exportKey(format, restricted)), dom("InvalidAccessError"));
  assert.equal(f.provider.exports, 0);
  assert.equal(f.provider.componentExports, 0);
  await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", publicKey)), dom("InvalidAccessError"));
  assert.equal(f.provider.exportFormat, "spki");
  for (const format of ["spki", "raw"]) {
    await assert.rejects(f.settle(f.subtle.exportKey(format, privateKey)), dom("InvalidAccessError"));
    assert.equal(f.provider.exportFormat, "pkcs8");
  }
  assert.equal(f.provider.exports, 3);
});

test("OKP import and generation reject inconsistent native metadata", async () => {
  const underlying = new NodeCryptoProvider().importKey({ format: "spki", bytes: okpSpki("Ed25519") });
  assert.ok(!("failure" in underlying));
  const f = fixture();
  for (const info of [
    { family: "secret", type: "secret", length: 256 } as const,
    { family: "OKP", type: "private", namedCurve: "Ed25519" } as const,
    { family: "OKP", type: "public", namedCurve: "X25519" } as const,
    { family: "OKP", type: "public", namedCurve: "Ed448" } as const,
  ]) {
    f.provider.importRecord = { handle: underlying.handle, info };
    await assert.rejects(f.settle(f.subtle.importKey("spki", okpSpki("Ed25519"), "Ed25519", true, ["verify"])), dom("OperationError"));
  }
  f.provider.generationRecord = { publicKey: underlying, privateKey: underlying };
  await assert.rejects(f.settle(f.subtle.generateKey("Ed25519", true, ["sign"])), dom("OperationError"));
});

test("OKP private JWK inspection rejects changed seed or invalid native components", async () => {
  const f = fixture();
  const original = parts("Ed25519", okpPrivateJwk("Ed25519"));
  for (const altered of [
    { family: "secret", k: new Uint8Array([1]) } as const,
    { ...original, namedCurve: "X25519" } as const,
    { ...original, x: original.x.subarray(1) }, { ...original, d: undefined },
    { ...original, d: new Uint8Array(32) }, { ...original, d: original.d!.subarray(1) },
  ]) {
    f.provider.exportParts = altered;
    await assert.rejects(f.settle(f.subtle.importKey("jwk", okpPrivateJwk("Ed25519"), "Ed25519", true, ["sign"])), dom("OperationError"));
  }
});

test("OKP exports reject nonconforming native encodings and components", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  for (const [format, key, invalid] of [
    ["raw", publicKey, okpRawPublic("Ed25519").subarray(1)],
    ["spki", publicKey, okpSpki("X25519")], ["pkcs8", privateKey, okpPkcs8("X25519")],
    ["pkcs8", privateKey, new Uint8Array(Buffer.concat([okpPkcs8("Ed25519"), Buffer.from([0])]))],
  ] as const) {
    f.provider.exportBytes = invalid;
    await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
  }
  f.provider.exportBytes = undefined;
  const original = parts("Ed25519", okpPrivateJwk("Ed25519"));
  for (const altered of [
    { family: "secret", k: new Uint8Array([1]) } as const,
    { ...original, namedCurve: "X25519" } as const,
    { ...original, x: original.x.subarray(1) },
    { ...original, d: undefined }, { ...original, d: original.d!.subarray(1) },
  ]) {
    f.provider.exportParts = altered;
    await assert.rejects(f.settle(f.subtle.exportKey("jwk", privateKey)), dom("OperationError"));
  }
});

test("OKP outputs own fresh buffers and dictionaries independently of public snapshots", async () => {
  const f = fixture();
  const publicKey = await f.imported("public");
  const privateKey = await f.imported("private");
  for (const [format, key, expected] of [["raw", publicKey, okpRawPublic("Ed25519")], ["spki", publicKey, okpSpki("Ed25519")], ["pkcs8", privateKey, okpPkcs8("Ed25519")]] as const) {
    const first = buffer(await f.settle(f.subtle.exportKey(format, key)));
    const second = buffer(await f.settle(f.subtle.exportKey(format, key)));
    assert.notEqual(first.buffer, second.buffer);
    assert.equal(first.byteOffset, 0);
    assert.equal(first.buffer.byteLength, first.byteLength);
    first.fill(0); assert.deepEqual(second, expected);
  }
  const dictionary = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  dictionary.x = "AA"; dictionary.key_ops!.push("verify");
  privateKey.algorithm.name = "X25519"; privateKey.usages.push("verify");
  const next = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
  assert.equal(next.x, okpPrivateJwk("Ed25519").x);
  assert.equal(next.crv, "Ed25519");
  assert.deepEqual(next.key_ops, ["sign"]);
  assert.equal(getCryptoKeySlots(privateKey).algorithm.name, "Ed25519");
});

test("OKP imports synchronously consume borrowed views before one scheduled settlement", async () => {
  const f = fixture();
  const original = okpPkcs8("Ed25519");
  const padded = new Uint8Array(original.length + 4); padded.set(original, 2);
  const encoded = padded.subarray(2, 2 + original.length);
  const pending = f.subtle.importKey("pkcs8", encoded, "Ed25519", true, ["sign"]);
  assert.equal(f.provider.imports, 1);
  assert.equal(f.provider.componentExports, 0);
  assert.ok(f.provider.importInput?.format === "pkcs8");
  assert.equal(f.provider.importInput.bytes, encoded);
  encoded.fill(0);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  const key = await f.settle(pending);
  assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), original);
  const bad = f.subtle.importKey("spki", new Uint8Array(), "Ed25519", true, ["verify"]);
  assert.equal(f.provider.imports, 1);
  await assert.rejects(f.settle(bad), dom("DataError"));
});
