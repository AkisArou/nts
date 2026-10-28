// Secure Curves §§4.3, 6.4; Web Cryptography §§9, 13–17;
// RFC 8410 §§3–4, 7, RFC 8032 §5.2, RFC 8037 §2 and RFC 7517 §4.
// https://wicg.github.io/webcrypto-secure-curves/
// Specification controls over native primitives, never Node WebCrypto.
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
import {
  curve448Pkcs8, curve448PrivateJwk, curve448PublicJwk, curve448RawPublic, curve448Spki,
} from "./curve448-fixtures.ts";
import type { Curve448FixtureName } from "./curve448-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { okpPkcs8, okpSpki } from "./okp-fixtures.ts";

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

function usagesFor(name: Curve448FixtureName, type: "public" | "private"): KeyUsage[] {
  return name === "Ed448" ? [type === "public" ? "verify" : "sign"] : type === "private" ? ["deriveKey", "deriveBits"] : [];
}
function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  let fills = 0;
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { fills++; bytes.fill(0x37); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function imported(name: Curve448FixtureName, type: "public" | "private", extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey(type === "public" ? "spki" : "pkcs8", type === "public" ? curve448Spki(name) : curve448Pkcs8(name), name, extractable, usagesFor(name, type)));
  }
  return { provider, scheduler, subtle, settle, imported, fills: () => fills };
}
function dom(name: string): (error: unknown) => boolean { return error => error instanceof DOMException && error.name === name; }
function pair(result: CryptoKey | CryptoKeyPair): CryptoKeyPair { assert.ok("privateKey" in result && "publicKey" in result); return result; }
function jwk(result: ArrayBuffer | JsonWebKeyObject): JsonWebKeyObject { assert.ok(!(result instanceof ArrayBuffer)); return result; }
function buffer(result: ArrayBuffer | JsonWebKeyObject): Uint8Array { assert.ok(result instanceof ArrayBuffer); return new Uint8Array(result); }
function parts(name: Curve448FixtureName, value: JsonWebKeyObject): CryptoOkpComponents {
  const x = new Uint8Array(Buffer.from(value.x!, "base64url"));
  return value.d === undefined ? { family: "OKP", namedCurve: name, x }
    : { family: "OKP", namedCurve: name, x, d: new Uint8Array(Buffer.from(value.d, "base64url")) };
}
function der(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const value = Buffer.concat(parts);
  assert.ok(value.length < 128);
  return new Uint8Array(Buffer.concat([Buffer.from([tag, value.length]), value]));
}
function publicDer(name: Curve448FixtureName, x: Uint8Array): Uint8Array {
  return der(0x30, der(0x30, der(6, new Uint8Array([0x2b, 0x65, name === "Ed448" ? 0x71 : 0x6f]))), der(3, new Uint8Array([0]), x));
}
function privateDer(name: Curve448FixtureName, d: Uint8Array): Uint8Array {
  return der(0x30, der(2, new Uint8Array([0])), der(0x30, der(6, new Uint8Array([0x2b, 0x65, name === "Ed448" ? 0x71 : 0x6f]))), der(4, der(4, d)));
}

for (const name of ["Ed448", "X448"] as const) {
  const width = name === "Ed448" ? 57 : 56;

  test(name + " imports and exports each key format with name-only metadata", async () => {
    const f = fixture();
    for (const format of ["raw", "spki", "jwk"] as const) {
      const data = format === "raw" ? curve448RawPublic(name) : format === "spki" ? curve448Spki(name) : curve448PublicJwk(name);
      const usages = usagesFor(name, "public");
      const key = await f.settle(f.subtle.importKey(format, data, name.toLowerCase(), true, usages));
      assert.equal(key.type, "public");
      assert.equal(key.extractable, true);
      assert.deepEqual(key.algorithm, { name });
      assert.deepEqual(Object.keys(key.algorithm), ["name"]);
      assert.deepEqual(key.usages, usages);
      const input = f.provider.importInput;
      assert.ok(input !== undefined);
      if (input.format === "raw" || input.format === "spki") assert.equal(input.bytes, data);
      else assert.ok(input.format === "components" && input.components.family === "OKP");
      const raw = buffer(await f.settle(f.subtle.exportKey("raw", key)));
      assert.equal(raw.byteLength, width);
      assert.deepEqual(raw, curve448RawPublic(name));
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("spki", key))), curve448Spki(name));
      assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", key))), {
        ...curve448PublicJwk(name), ...(name === "Ed448" ? { alg: "Ed448" } : {}), ext: true, key_ops: usages,
      });
    }
    for (const format of ["pkcs8", "jwk"] as const) {
      const key = await f.settle(f.subtle.importKey(format, format === "pkcs8" ? curve448Pkcs8(name) : curve448PrivateJwk(name), name, true, usagesFor(name, "private")));
      assert.equal(key.type, "private");
      assert.deepEqual(key.algorithm, { name });
      assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), curve448Pkcs8(name));
      assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", key))), {
        ...curve448PrivateJwk(name), ...(name === "Ed448" ? { alg: "Ed448" } : {}), ext: true, key_ops: usagesFor(name, "private"),
      });
    }
    assert.equal(f.provider.imports, 5);
    assert.equal(f.fills(), 0);
  });

  test(name + " generation splits usages and keeps public metadata snapshots independent", async () => {
    const f = fixture();
    const usages = name === "Ed448" ? ["verify", "sign", "verify"] : ["deriveBits", "deriveKey", "deriveBits"];
    const generated = pair(await f.settle(f.subtle.generateKey(name, false, usages)));
    assert.equal(generated.publicKey.extractable, true);
    assert.equal(generated.privateKey.extractable, false);
    assert.deepEqual(generated.publicKey.usages, usagesFor(name, "public"));
    assert.deepEqual(generated.privateKey.usages, usagesFor(name, "private"));
    assert.deepEqual(generated.publicKey.algorithm, { name });
    assert.deepEqual(generated.privateKey.algorithm, { name });
    assert.notEqual(generated.publicKey.algorithm, generated.privateKey.algorithm);
    assert.equal(generated.publicKey.algorithm, generated.publicKey.algorithm);
    assert.equal(buffer(await f.settle(f.subtle.exportKey("raw", generated.publicKey))).byteLength, width);
    const publicAlgorithm = generated.publicKey.algorithm as { name: string };
    publicAlgorithm.name = "changed";
    generated.publicKey.usages.push("encrypt");
    assert.deepEqual(jwk(await f.settle(f.subtle.exportKey("jwk", generated.publicKey))).key_ops, usagesFor(name, "public"));
    assert.deepEqual(generated.privateKey.algorithm, { name });
    assert.deepEqual(f.provider.generationInput, { family: "OKP", namedCurve: name });
    assert.equal(f.provider.generations, 1);
    assert.equal(f.fills(), 0);
  });

  test(name + " rejects generation usages before native work and empty private usages afterwards", async () => {
    const f = fixture();
    for (const usage of name === "Ed448" ? ["deriveBits", "deriveKey", "encrypt"] : ["sign", "verify", "encrypt"]) {
      await assert.rejects(f.settle(f.subtle.generateKey(name, true, [usage])), dom("SyntaxError"));
    }
    assert.equal(f.provider.generations, 0);
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.generations, 1);
    if (name === "Ed448") {
      await assert.rejects(f.settle(f.subtle.generateKey(name, true, ["verify"])), dom("SyntaxError"));
      assert.equal(f.provider.generations, 2);
    }
  });

  test(name + " validates import usage before encoding and empty private usage after consistency", async () => {
    const f = fixture();
    for (const format of ["raw", "spki", "pkcs8"] as const) {
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), name, true, ["encrypt"])), dom("SyntaxError"));
      await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(), name, true, [])), dom("DataError"));
    }
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { kty: "wrong", d: "" }, name, true, ["verify"])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 0);
    const publicKey = await f.settle(f.subtle.importKey("raw", curve448RawPublic(name), name, false, []));
    assert.deepEqual(publicKey.usages, []);
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", curve448Pkcs8(name), name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 2);
    assert.equal(f.provider.componentExports, 0);
    await assert.rejects(f.settle(f.subtle.importKey("jwk", curve448PrivateJwk(name), name, true, [])), dom("SyntaxError"));
    assert.equal(f.provider.componentExports, 1);
  });

  test(name + " public imports retain opaque encoded octets across raw, SPKI and JWK", async () => {
    const f = fixture();
    const values = [new Uint8Array(width), new Uint8Array(width).fill(0xff), new Uint8Array(width).fill(0x80)];
    for (const x of values) {
      for (const format of ["raw", "spki", "jwk"] as const) {
        const data = format === "raw" ? x : format === "spki" ? publicDer(name, x)
          : { kty: "OKP", crv: name, x: Buffer.from(x).toString("base64url") };
        const key = await f.settle(f.subtle.importKey(format, data, name, true, usagesFor(name, "public")));
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("raw", key))), x);
        assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).x, Buffer.from(x).toString("base64url"));
      }
    }
    assert.equal(f.provider.imports, 9, "on-curve, canonical and small-order checks belong to operations");
  });

  test(name + " raw public imports enforce the encoded width instead of the curve name's bit count", async () => {
    const f = fixture();
    for (const size of [0, 32, width - 1, width + 1, width * 2]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(size), name, true, usagesFor(name, "public"))), dom("DataError"));
    }
    assert.equal(f.provider.imports, 0);
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(width), name, true, usagesFor(name, "public")));
    assert.equal(buffer(await f.settle(f.subtle.exportKey("raw", key))).byteLength, width);
    // In particular, RFC 8032 requires 57 bytes for Ed448; the draft's raw
    // import text says 448 bits in error, which would discard its sign octet.
  });

  test(name + " rejects original DER suffixes accepted by native decoders", async () => {
    const f = fixture();
    for (const format of ["spki", "pkcs8"] as const) {
      const original = format === "spki" ? curve448Spki(name) : curve448Pkcs8(name);
      const encoded = new Uint8Array(Buffer.concat([original, Buffer.from([0])]));
      const native = new NodeCryptoProvider().importKey({ format, bytes: encoded });
      assert.ok(!("failure" in native), "control: native parser accepts a trailing octet");
      await assert.rejects(f.settle(f.subtle.importKey(format, encoded, name, true, usagesFor(name, format === "spki" ? "public" : "private"))), dom("DataError"));
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " JWK enforces kty, crv, use, key_ops and ext before native import", async () => {
    const f = fixture();
    const usages = usagesFor(name, "private");
    for (const data of [
      { ...curve448PrivateJwk(name), kty: "EC" }, { ...curve448PrivateJwk(name), kty: "okp" },
      { ...curve448PrivateJwk(name), crv: name.toLowerCase() }, { ...curve448PrivateJwk(name), crv: undefined },
      { ...curve448PrivateJwk(name), crv: name === "Ed448" ? "Ed25519" : "X25519" },
      { ...curve448PrivateJwk(name), use: name === "Ed448" ? "enc" : "sig" },
      { ...curve448PrivateJwk(name), key_ops: [usages[0]!, usages[0]!] },
      { ...curve448PrivateJwk(name), key_ops: ["unknown", "unknown", ...usages] },
      { ...curve448PrivateJwk(name), key_ops: [] }, { ...curve448PrivateJwk(name), ext: false },
    ]) await assert.rejects(f.settle(f.subtle.importKey("jwk", data, name, true, usages)), dom("DataError"));
    assert.equal(f.provider.imports, 0);
    const privateKey = await f.settle(f.subtle.importKey("jwk", { ...curve448PrivateJwk(name), key_ops: ["unknown", ...usages], ext: false }, name, false, usages));
    assert.deepEqual(privateKey.usages, usages);
    const publicKey = await f.settle(f.subtle.importKey("jwk", { ...curve448PublicJwk(name), use: "arbitrary", key_ops: [] }, name, true, []));
    assert.deepEqual(publicKey.usages, []);
  });

  test(name + " JWK requires canonical base64url and full-width x and d", async () => {
    const f = fixture();
    const original = curve448PrivateJwk(name);
    for (const member of ["x", "d"] as const) {
      const value = Buffer.from(original[member], "base64url");
      for (const altered of ["", "AA", "A", "!", original[member] + "=", value.subarray(1).toString("base64url"), Buffer.concat([value, Buffer.from([0])]).toString("base64url")]) {
        await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...original, [member]: altered }, name, true, usagesFor(name, "private"))), dom("DataError"));
      }
    }
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...original, x: undefined }, name, true, usagesFor(name, "private"))), dom("DataError"));
    assert.equal(f.provider.imports, 0);
  });

  test(name + " rejects inconsistent private JWK public octets after native import", async () => {
    const original = curve448PrivateJwk(name);
    const altered = new Uint8Array(Buffer.from(original.x, "base64url")); altered[0]! ^= 1;
    const supplied = { ...original, x: Buffer.from(altered).toString("base64url") };
    const native = new NodeCryptoProvider();
    const accepted = native.importKey({ format: "components", components: parts(name, supplied) });
    assert.ok(!("failure" in accepted), "control: native derives the public key from d");
    const actual = native.exportComponents(accepted.handle);
    assert.ok(!("failure" in actual) && actual.family === "OKP");
    assert.equal(Buffer.from(actual.x).toString("base64url"), original.x);
    const f = fixture();
    await assert.rejects(f.settle(f.subtle.importKey("jwk", supplied, name, true, usagesFor(name, "private"))), dom("DataError"));
    assert.equal(f.provider.imports, 1);
    assert.equal(f.provider.componentExports, 1);
    await assert.rejects(f.settle(f.subtle.importKey("jwk", supplied, name, true, [])), dom("DataError"));
  });

  test(name + " retains original private seed octets including bits pruned by the native operation", async () => {
    const f = fixture();
    for (const d of [new Uint8Array(width), new Uint8Array(width).fill(0xff), new Uint8Array(width).fill(0x80)]) {
      const encoded = privateDer(name, d);
      const native = createPrivateKey({ key: Buffer.from(encoded), format: "der", type: "pkcs8" });
      const x = createPublicKey(native).export({ format: "jwk" }).x!;
      const data = { kty: "OKP", crv: name, x, d: Buffer.from(d).toString("base64url") };
      for (const format of ["jwk", "pkcs8"] as const) {
        const key = await f.settle(f.subtle.importKey(format, format === "jwk" ? data : encoded, name, true, usagesFor(name, "private")));
        assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).d, data.d);
        assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), encoded);
      }
    }
  });

  test(name + " rejects native metadata for the wrong curve, key type or family", async () => {
    const native = new NodeCryptoProvider().importKey({ format: "spki", bytes: curve448Spki(name) });
    assert.ok(!("failure" in native));
    const f = fixture();
    for (const info of [
      { family: "secret", type: "secret", length: width * 8 } as const,
      { family: "OKP", type: "private", namedCurve: name } as const,
      { family: "OKP", type: "public", namedCurve: name === "Ed448" ? "Ed25519" : "X25519" } as const,
      { family: "OKP", type: "public", namedCurve: name === "Ed448" ? "X448" : "Ed448" } as const,
    ]) {
      f.provider.importRecord = { handle: native.handle, info };
      await assert.rejects(f.settle(f.subtle.importKey("spki", curve448Spki(name), name, true, usagesFor(name, "public"))), dom("OperationError"));
    }
    f.provider.generationRecord = { publicKey: native, privateKey: native };
    await assert.rejects(f.settle(f.subtle.generateKey(name, true, usagesFor(name, "private"))), dom("OperationError"));
  });

  test(name + " validates native component widths and unchanged d on private import and export", async () => {
    const f = fixture();
    const privateKey = await f.imported(name, "private");
    const original = parts(name, curve448PrivateJwk(name));
    for (const altered of [
      { family: "secret", k: new Uint8Array([1]) } as const,
      { ...original, namedCurve: name === "Ed448" ? "X448" : "Ed448" } as const,
      { ...original, x: new Uint8Array(32) }, { ...original, x: original.x.subarray(1) },
      { ...original, d: undefined }, { ...original, d: original.d!.subarray(1) },
    ]) {
      f.provider.exportParts = altered;
      await assert.rejects(f.settle(f.subtle.importKey("jwk", curve448PrivateJwk(name), name, true, usagesFor(name, "private"))), dom("OperationError"));
      await assert.rejects(f.settle(f.subtle.exportKey("jwk", privateKey)), dom("OperationError"));
    }
    f.provider.exportParts = { ...original, d: new Uint8Array(width) };
    await assert.rejects(f.settle(f.subtle.importKey("jwk", curve448PrivateJwk(name), name, true, usagesFor(name, "private"))), dom("OperationError"));
  });

  test(name + " export checks extractability before material access and type after access", async () => {
    const f = fixture();
    const publicKey = await f.imported(name, "public");
    const privateKey = await f.imported(name, "private");
    const restricted = await f.imported(name, "private", false);
    for (const format of ["raw", "spki", "pkcs8", "jwk"]) {
      await assert.rejects(f.settle(f.subtle.exportKey(format, restricted)), dom("InvalidAccessError"));
    }
    assert.equal(f.provider.exports, 0);
    assert.equal(f.provider.componentExports, 0);
    await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", publicKey)), dom("InvalidAccessError"));
    assert.equal(f.provider.exportFormat, "spki");
    for (const format of ["spki", "raw"]) {
      await assert.rejects(f.settle(f.subtle.exportKey(format, privateKey)), dom("InvalidAccessError"));
      assert.equal(f.provider.exportFormat, "pkcs8");
    }
    f.provider.exportFailure = { failure: "invalid-key" };
    await assert.rejects(f.settle(f.subtle.exportKey("pkcs8", publicKey)), dom("OperationError"));
  });

  test(name + " rejects native exports with wrong widths, algorithms or trailing data", async () => {
    const f = fixture();
    const publicKey = await f.imported(name, "public");
    const privateKey = await f.imported(name, "private");
    for (const [format, key, invalid] of [
      ["raw", publicKey, curve448RawPublic(name).subarray(1)],
      ["raw", publicKey, new Uint8Array(32)],
      ["spki", publicKey, curve448Spki(name === "Ed448" ? "X448" : "Ed448")],
      ["pkcs8", privateKey, curve448Pkcs8(name === "Ed448" ? "X448" : "Ed448")],
      ["pkcs8", privateKey, new Uint8Array(Buffer.concat([curve448Pkcs8(name), Buffer.from([0])]))],
    ] as const) {
      f.provider.exportBytes = invalid;
      await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
    }
  });

  test(name + " owns export buffers and dictionaries independently of public key snapshots", async () => {
    const f = fixture();
    const publicKey = await f.imported(name, "public");
    const privateKey = await f.imported(name, "private");
    for (const [format, key, expected] of [["raw", publicKey, curve448RawPublic(name)], ["spki", publicKey, curve448Spki(name)], ["pkcs8", privateKey, curve448Pkcs8(name)]] as const) {
      const first = buffer(await f.settle(f.subtle.exportKey(format, key)));
      const second = buffer(await f.settle(f.subtle.exportKey(format, key)));
      assert.notEqual(first.buffer, second.buffer);
      assert.equal(first.byteOffset, 0);
      assert.equal(first.buffer.byteLength, first.byteLength);
      first.fill(0); assert.deepEqual(second, expected);
    }
    const dictionary = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
    dictionary.x = "AA"; dictionary.key_ops!.push("encrypt");
    privateKey.algorithm.name = "changed"; privateKey.usages.push("encrypt");
    const next = jwk(await f.settle(f.subtle.exportKey("jwk", privateKey)));
    assert.equal(next.x, curve448PrivateJwk(name).x);
    assert.equal(next.crv, name);
    assert.deepEqual(next.key_ops, usagesFor(name, "private"));
    assert.equal(getCryptoKeySlots(privateKey).algorithm.name, name);
  });

  test(name + " borrows import view bounds synchronously and schedules settlement", async () => {
    const f = fixture();
    const original = curve448Pkcs8(name);
    const padded = new Uint8Array(original.length + 4); padded.set(original, 2);
    const pending = f.subtle.importKey("pkcs8", new DataView(padded.buffer, 2, original.length), name, true, usagesFor(name, "private"));
    assert.equal(f.provider.imports, 1);
    assert.equal(f.provider.componentExports, 0);
    assert.ok(f.provider.importInput?.format === "pkcs8");
    assert.equal(f.provider.importInput.bytes.buffer, padded.buffer);
    assert.equal(f.provider.importInput.bytes.byteOffset, 2);
    assert.equal(f.provider.importInput.bytes.byteLength, original.byteLength);
    padded.fill(0);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    const key = await f.settle(pending);
    assert.deepEqual(buffer(await f.settle(f.subtle.exportKey("pkcs8", key))), original);
    f.provider.importFailure = { failure: "operation" };
    const failed = f.subtle.importKey("pkcs8", original, name, true, usagesFor(name, "private"));
    const rejected = assert.rejects(failed, dom("OperationError"));
    assert.equal(f.provider.imports, 2);
    f.scheduler.runPending();
    await rejected;
  });

  for (const failure of ["invalid-key", "operation"] as const) {
    test(name + " maps native " + failure + " failures at each key boundary", async () => {
      const f = fixture();
      f.provider.importFailure = { failure };
      await assert.rejects(f.settle(f.subtle.importKey("raw", curve448RawPublic(name), name, true, usagesFor(name, "public"))), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
      f.provider.importFailure = undefined;
      const key = await f.imported(name, "public");
      f.provider.exportFailure = { failure };
      for (const format of ["raw", "spki", "pkcs8", "jwk"]) {
        await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("OperationError"));
      }
      await assert.rejects(f.settle(f.subtle.importKey("jwk", curve448PrivateJwk(name), name, true, usagesFor(name, "private"))), dom("OperationError"));
      f.provider.generationFailure = { failure };
      await assert.rejects(f.settle(f.subtle.generateKey(name, true, usagesFor(name, "private"))), dom("OperationError"));
    });
  }
}

test("Ed448 accepts fully specified and legacy JWK alg names and exports Ed448", async () => {
  const f = fixture();
  for (const alg of [undefined, "Ed448", "EdDSA"]) {
    const key = await f.settle(f.subtle.importKey("jwk", { ...curve448PublicJwk("Ed448"), alg }, "Ed448", true, ["verify"]));
    assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).alg, "Ed448");
  }
  for (const alg of ["ed448", "eddsa", "Ed25519", "X448", "ES512", ""]) {
    await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...curve448PublicJwk("Ed448"), alg }, "Ed448", true, ["verify"])), dom("DataError"));
  }
});

test("X448 ignores JWK alg and omits it from exports", async () => {
  const f = fixture();
  for (const alg of [undefined, "X448", "ECDH-ES", "Ed448", "", "unknown"]) {
    const key = await f.settle(f.subtle.importKey("jwk", { ...curve448PublicJwk("X448"), alg }, "X448", true, []));
    assert.equal(jwk(await f.settle(f.subtle.exportKey("jwk", key))).alg, undefined);
  }
});

test("448 imports reject DER for every other registered OKP algorithm before native work", async () => {
  const f = fixture();
  for (const name of ["Ed448", "X448"] as const) {
    for (const other of ["Ed25519", "X25519", name === "Ed448" ? "X448" : "Ed448"] as const) {
      const spki = other === "Ed25519" || other === "X25519" ? okpSpki(other) : curve448Spki(other);
      const pkcs8 = other === "Ed25519" || other === "X25519" ? okpPkcs8(other) : curve448Pkcs8(other);
      await assert.rejects(f.settle(f.subtle.importKey("spki", spki, name, true, usagesFor(name, "public"))), dom("DataError"));
      await assert.rejects(f.settle(f.subtle.importKey("pkcs8", pkcs8, name, true, usagesFor(name, "private"))), dom("DataError"));
    }
  }
  assert.equal(f.provider.imports, 0);
});
