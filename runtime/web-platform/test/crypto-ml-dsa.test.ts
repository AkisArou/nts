// Modern Algorithms §§3.1.1, 3.2.5 and 8.4; FIPS 204; RFC 9881.
// Unedited WPT supplies independent known signatures. These controls exercise
// policy, exact encodings, ownership and native failures at the typed seam.
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { createCryptoKey, getCryptoKeySlots, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, CryptoKeyPair } from "../src/crypto/crypto-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type {
  CryptoFailure, CryptoKeyHandle, CryptoKeyImport, CryptoKeyRecord,
  CryptoMlDsaName, CryptoSignature, CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

const names: readonly CryptoMlDsaName[] = ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"];
const message = new Uint8Array([0, 1, 0xff, 0x80, 7]);

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  signs = 0;
  publics = 0;
  failure: CryptoFailure | undefined;
  publicResult: CryptoKeyRecord | undefined;
  parameters: CryptoSignatureParameters | undefined;
  input: Uint8Array | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    return this.failure ?? super.importKey(input);
  }

  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.parameters = parameters;
    this.input = bytes;
    return this.failure ?? super.sign(parameters, key, bytes);
  }

  override getPublicKey(key: CryptoKeyHandle): CryptoKeyRecord | CryptoFailure {
    this.publics++;
    return this.failure ?? this.publicResult ?? super.getPublicKey(key);
  }

  override verify(parameters: CryptoSignatureParameters, key: CryptoKeyHandle,
    signature: CryptoSignature, bytes: Uint8Array): boolean | CryptoFailure {
    return this.failure ?? super.verify(parameters, key, signature, bytes);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const subtle = createCrypto({ fill(bytes): void { bytes.fill(11); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function privateKey(name: CryptoMlDsaName, extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey("raw-seed", new Uint8Array(32).fill(7), name, extractable, ["sign"]));
  }
  return { provider, scheduler, subtle, settle, privateKey };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

function der(tag: number, value: Uint8Array): Buffer {
  const length: number[] = [];
  let remaining = value.byteLength;
  if (remaining < 128) length.push(remaining);
  else {
    while (remaining !== 0) { length.unshift(remaining % 256); remaining = Math.floor(remaining / 256); }
    length.unshift(0x80 + length.length);
  }
  return Buffer.concat([Buffer.from([tag, ...length]), value]);
}

function pkcs8(name: CryptoMlDsaName, inner: Uint8Array, nullParameters = false): Buffer {
  const oid = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03,
    name === "ML-DSA-44" ? 17 : name === "ML-DSA-65" ? 18 : 19]);
  const algorithm = der(0x30, Buffer.concat([der(0x06, oid), nullParameters ? Buffer.from([5, 0]) : Buffer.alloc(0)]));
  return der(0x30, Buffer.concat([Buffer.from([2, 1, 0]), algorithm, der(4, inner)]));
}

for (const name of names) {
  test(name + " retains seeds, round-trips all formats and signs pure ML-DSA with context", async () => {
    const f = fixture();
    const key = await f.privateKey(name);
    const publicKey = await f.settle(f.subtle.getPublicKey(key, ["verify", "verify"]));
    assert.deepEqual(publicKey.usages, ["verify"]);
    const seed = await f.settle(f.subtle.exportKey("raw-seed", key)) as ArrayBuffer;
    assert.deepEqual(new Uint8Array(seed), new Uint8Array(32).fill(7));
    const context = new Uint8Array([1, 0xff, 0]);
    const signature = await f.settle(f.subtle.sign({ name, context }, key, message));
    assert.equal(await f.settle(f.subtle.verify({ name, context }, publicKey, signature, message)), true);
    assert.equal(await f.settle(f.subtle.verify({ name, context: new Uint8Array([1]) }, publicKey, signature, message)), false);
    const encodedPrivate = await f.settle(f.subtle.exportKey("pkcs8", key)) as ArrayBuffer;
    assert.deepEqual(Buffer.from(encodedPrivate), pkcs8(name, der(0x80, new Uint8Array(32).fill(7))));
    const nativePrivate = createPrivateKey({ key: Buffer.from(encodedPrivate), format: "der", type: "pkcs8" });
    assert.equal(verify(null, message, { key: createPublicKey(nativePrivate), context }, new Uint8Array(signature)), true);
    const nativeSignature = sign(null, message, { key: nativePrivate, context });
    assert.equal(await f.settle(f.subtle.verify({ name, context }, publicKey, nativeSignature, message)), true);
    for (const format of ["spki", "raw-public", "jwk"] as const) {
      const material = await f.settle(f.subtle.exportKey(format, publicKey));
      const imported = await f.settle(f.subtle.importKey(format, material, name, true, ["verify"]));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, imported)), material);
    }
    for (const format of ["pkcs8", "raw-seed", "jwk"] as const) {
      const material = await f.settle(f.subtle.exportKey(format, key));
      const imported = await f.settle(f.subtle.importKey(format, material, name, true, ["sign"]));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, imported)), material);
    }
  });

  test(name + " native generation preserves its private seed and partitions usages", async () => {
    const f = fixture();
    const pair = await f.settle(f.subtle.generateKey(name, true, ["verify", "sign", "verify"])) as CryptoKeyPair;
    assert.deepEqual(pair.privateKey.usages, ["sign"]);
    assert.deepEqual(pair.publicKey.usages, ["verify"]);
    const seed = await f.settle(f.subtle.exportKey("raw-seed", pair.privateKey));
    const imported = await f.settle(f.subtle.importKey("raw-seed", seed, name, true, ["sign"]));
    const derived = await f.settle(f.subtle.getPublicKey(imported, []));
    assert.deepEqual(await f.settle(f.subtle.exportKey("spki", derived)), await f.settle(f.subtle.exportKey("spki", pair.publicKey)));
  });

  test(name + " checks PKCS8 both against native seed expansion and rejects expanded-only", async () => {
    const f = fixture();
    const original = pkcs8(name, der(0x80, new Uint8Array(32).fill(7)));
    const native = createPrivateKey({ key: original, format: "der", type: "pkcs8" });
    const both = native.export({ format: "der", type: "pkcs8" });
    const imported = await f.settle(f.subtle.importKey("pkcs8", both, name, true, ["sign"]));
    assert.deepEqual(Buffer.from(await f.settle(f.subtle.exportKey("pkcs8", imported)) as ArrayBuffer), original);
    const corrupt = Buffer.from(both); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", corrupt, name, true, ["sign"])), dom("DataError"));
    const size = name === "ML-DSA-44" ? 2560 : name === "ML-DSA-65" ? 4032 : 4896;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", pkcs8(name, der(4, new Uint8Array(size))), name, true, ["sign"])), dom("NotSupportedError"));
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", pkcs8(name, der(4, new Uint8Array(size - 1))), name, true, ["sign"])), dom("DataError"));
  });

  test(name + " rejects DER trailing bytes, parameters, mismatched OIDs and seed widths before native import", async () => {
    const f = fixture();
    const good = pkcs8(name, der(0x80, new Uint8Array(32)));
    for (const bad of [Buffer.concat([good, Buffer.from([0])]), pkcs8(name, der(0x80, new Uint8Array(32)), true),
      pkcs8(name, der(0x80, new Uint8Array(31))), pkcs8(name === "ML-DSA-44" ? "ML-DSA-65" : "ML-DSA-44", der(0x80, new Uint8Array(32)))]) {
      await assert.rejects(f.settle(f.subtle.importKey("pkcs8", bad, name, true, ["sign"])), dom("DataError"));
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " JWK policy rejects missing fields, wrong alg, altered public material and extractability", async () => {
    const f = fixture();
    const key = await f.privateKey(name);
    const jwk = await f.settle(f.subtle.exportKey("jwk", key)) as JsonWebKeyObject;
    assert.deepEqual(Object.keys(jwk).sort(), ["alg", "ext", "key_ops", "kty", "priv", "pub"]);
    for (const bad of [{ ...jwk, kty: "OKP" }, { ...jwk, alg: undefined }, { ...jwk, priv: "AA" },
      { ...jwk, pub: undefined }, { ...jwk, pub: "A" + jwk.pub!.slice(1) }, { ...jwk, ext: false },
      { ...jwk, use: "enc" }, { ...jwk, key_ops: ["verify"] }, { ...jwk, key_ops: ["sign", "sign"] }]) {
      await assert.rejects(f.settle(f.subtle.importKey("jwk", bad, name, true, ["sign"])), dom("DataError"));
    }
  });

  test(name + " accepts ordinary view ranges and takes ownership at import", async () => {
    const f = fixture();
    const storage = new Uint8Array(40).fill(3);
    const key = await f.settle(f.subtle.importKey("raw-seed", new DataView(storage.buffer, 4, 32), name, true, ["sign"]));
    storage.fill(0);
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.exportKey("raw-seed", key)) as ArrayBuffer), new Uint8Array(32).fill(3));
    const first = await f.settle(f.subtle.exportKey("raw-seed", key)) as ArrayBuffer;
    new Uint8Array(first).fill(0);
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.exportKey("raw-seed", key)) as ArrayBuffer), new Uint8Array(32).fill(3));
  });

  test(name + " enforces context bounds before key type after outer usage checks", async () => {
    const f = fixture();
    const key = await f.privateKey(name);
    const signature = await f.settle(f.subtle.sign({ name, context: new Uint8Array(255) }, key, message));
    const publicKey = await f.settle(f.subtle.getPublicKey(key, ["verify"]));
    assert.equal(await f.settle(f.subtle.verify({ name, context: new Uint8Array(255) }, publicKey, signature, message)), true);
    await assert.rejects(f.settle(f.subtle.sign({ name, context: new Uint8Array(256) }, key, message)), dom("OperationError"));
    const forged = createCryptoKey("public", true, new KeyAlgorithm(name), ["sign"], getCryptoKeySlots(publicKey).handle);
    await assert.rejects(f.settle(f.subtle.sign({ name, context: new Uint8Array(256) }, forged, message)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.sign(name, forged, message)), dom("InvalidAccessError"));
    assert.equal(await f.settle(f.subtle.verify(name, publicKey, new Uint8Array(0), message)), false);
  });
}

test("ML-DSA import and signing map native failures as values at the specified steps", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["verify"]));
  f.provider.failure = { failure: "operation" };
  await assert.rejects(f.settle(f.subtle.sign("ML-DSA-44", key, message)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.verify("ML-DSA-44", publicKey, new Uint8Array(2420), message)), dom("OperationError"));
  await assert.rejects(f.settle(f.subtle.importKey("raw-seed", new Uint8Array(32), "ML-DSA-44", false, ["sign"])), dom("OperationError"));
  f.provider.failure = { failure: "invalid-key" };
  await assert.rejects(f.settle(f.subtle.importKey("raw-seed", new Uint8Array(32), "ML-DSA-44", false, ["sign"])), dom("DataError"));
});

test("ML-DSA conversion order and whole-operation dispatch preserve buffer ranges", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44");
  const reads: string[] = [];
  const storage = new Uint8Array([99, 1, 2, 3, 99]);
  const context = new Uint8Array([7, 8]);
  const algorithm = {
    get name(): string { reads.push("name"); return "ml-dsa-44"; },
    get context(): Uint8Array { reads.push("context"); return context; },
  };
  const pending = f.subtle.sign(algorithm, key, new DataView(storage.buffer, 1, 3));
  assert.deepEqual(reads, ["name", "name", "context"]);
  assert.equal(f.provider.signs, 1);
  assert.deepEqual(f.provider.input, new Uint8Array([1, 2, 3]));
  assert.equal(f.provider.input!.buffer, storage.buffer);
  assert.equal(f.provider.parameters!.name, "ML-DSA-44");
  await f.settle(pending);
});

test("Modern raw formats are recognized globally and restricted by each key algorithm", async () => {
  const f = fixture();
  const privateKey = await f.privateKey("ML-DSA-44");
  const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["verify"]));
  for (const format of ["raw", "raw-private"] as const) {
    await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(32), "ML-DSA-44", false, ["sign"])), dom("NotSupportedError"));
    await assert.rejects(f.settle(f.subtle.exportKey(format, privateKey)), dom("NotSupportedError"));
  }
  await assert.rejects(f.settle(f.subtle.exportKey("raw-public", privateKey)), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.exportKey("raw-seed", publicKey)), dom("InvalidAccessError"));
  const secret = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]));
  await assert.rejects(f.settle(f.subtle.exportKey("raw-public", secret)), dom("NotSupportedError"));
});

test("getPublicKey ignores private extractability and mutable public snapshots, with one native call", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44", false);
  key.algorithm.name = "AES-GCM"; key.usages.length = 0;
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["verify"]));
  assert.equal(publicKey.algorithm.name, "ML-DSA-44");
  assert.equal(publicKey.extractable, true);
  assert.equal(f.provider.publics, 1);
  assert.notEqual(publicKey.algorithm, key.algorithm);
  assert.notEqual(getCryptoKeySlots(publicKey).handle, getCryptoKeySlots(key).handle);
});

test("getPublicKey IDL and usage errors precede native work and preserve algorithm/type distinctions", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, []));
  f.provider.publics = 0;
  await assert.rejects(f.settle(f.subtle.getPublicKey({}, [])), TypeError);
  await assert.rejects(f.settle(f.subtle.getPublicKey(key, ["unknown"])), TypeError);
  await assert.rejects(f.settle(f.subtle.getPublicKey(key, ["sign"])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.getPublicKey(publicKey, ["sign"])), dom("InvalidAccessError"));
  const secret = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]));
  await assert.rejects(f.settle(f.subtle.getPublicKey(secret, [])), dom("NotSupportedError"));
  assert.equal(f.provider.publics, 0);
});

test("getPublicKey maps native failure and inconsistent public metadata to OperationError", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44");
  f.provider.failure = { failure: "operation" };
  await assert.rejects(f.settle(f.subtle.getPublicKey(key, [])), dom("OperationError"));
  f.provider.failure = undefined;
  f.provider.publicResult = { handle: getCryptoKeySlots(key).handle, info: { family: "ML", name: "ML-DSA-44", type: "private" } };
  await assert.rejects(f.settle(f.subtle.getPublicKey(key, [])), dom("OperationError"));
});

test("ML-DSA wrapping uses the internal AKP serializer and importer", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-DSA-44");
  const wrapping = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ["wrapKey", "unwrapKey"]));
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) };
  f.subtle.exportKey = (): never => { throw new Error("public exportKey override invoked"); };
  f.subtle.importKey = (): never => { throw new Error("public importKey override invoked"); };
  const wrapped = await f.settle(f.subtle.wrapKey("jwk", key, wrapping, algorithm));
  const result = await f.settle(f.subtle.unwrapKey("jwk", wrapped, wrapping, algorithm, "ML-DSA-44", false, ["sign"]));
  const signature = await f.settle(f.subtle.sign("ML-DSA-44", result, message));
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["verify"]));
  assert.equal(await f.settle(f.subtle.verify("ML-DSA-44", publicKey, signature, message)), true);
});
