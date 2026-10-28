// Modern Algorithms §§3.1.2, 3.2.1–5, 4 and 6; FIPS 203; RFC 9935.
// Independent decapsulation vectors live in the unedited WPT fixtures. These
// controls cover native input checks, implicit rejection, ownership and policy.
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, decapsulate, encapsulate } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { createCryptoKey, getCryptoKeySlots, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import type { CryptoKey, CryptoKeyPair } from "../src/crypto/crypto-key.ts";
import type { JsonWebKeyObject } from "../src/crypto/jwk.ts";
import type { EncapsulatedBits, EncapsulatedKey } from "../src/crypto/ml-kem.ts";
import type {
  CryptoEncapsulation, CryptoFailure, CryptoKemParameters, CryptoKeyHandle,
  CryptoKeyImport, CryptoKeyRecord, CryptoMlKemName,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

const names: readonly CryptoMlKemName[] = ["ML-KEM-512", "ML-KEM-768", "ML-KEM-1024"];

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  encapsulations = 0;
  decapsulations = 0;
  publics = 0;
  failure: CryptoFailure | undefined;
  encapsulated: CryptoEncapsulation | undefined;
  decapsulated: Uint8Array | undefined;
  input: Uint8Array | undefined;
  imported: CryptoKeyImport | undefined;
  parameters: CryptoKemParameters | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    this.imported = input;
    return this.failure ?? super.importKey(input);
  }

  override encapsulate(parameters: CryptoKemParameters, key: CryptoKeyHandle): CryptoEncapsulation | CryptoFailure {
    this.encapsulations++;
    this.parameters = parameters;
    return this.failure ?? this.encapsulated ?? super.encapsulate(parameters, key);
  }

  override decapsulate(parameters: CryptoKemParameters, key: CryptoKeyHandle, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.decapsulations++;
    this.parameters = parameters;
    this.input = bytes;
    return this.failure ?? this.decapsulated ?? super.decapsulate(parameters, key, bytes);
  }

  override getPublicKey(key: CryptoKeyHandle): CryptoKeyRecord | CryptoFailure {
    this.publics++;
    return this.failure ?? super.getPublicKey(key);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const subtle = createCrypto({ fill(bytes): void { bytes.fill(11); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function privateKey(name: CryptoMlKemName, extractable = true): Promise<CryptoKey> {
    return settle(subtle.importKey("raw-seed", new Uint8Array(64).fill(7), name, extractable, ["decapsulateKey", "decapsulateBits"]));
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

function pkcs8(name: CryptoMlKemName, inner: Uint8Array, nullParameters = false): Buffer {
  const oid = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x04,
    name === "ML-KEM-512" ? 1 : name === "ML-KEM-768" ? 2 : 3]);
  const algorithm = der(0x30, Buffer.concat([der(0x06, oid), nullParameters ? Buffer.from([5, 0]) : Buffer.alloc(0)]));
  return der(0x30, Buffer.concat([Buffer.from([2, 1, 0]), algorithm, der(4, inner)]));
}

for (const name of names) {
  test(name + " retains its 64-byte seed and round-trips public/private encodings", async () => {
    const f = fixture();
    const privateKey = await f.privateKey(name);
    const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["encapsulateBits", "encapsulateKey"]));
    assert.deepEqual(publicKey.usages, ["encapsulateKey", "encapsulateBits"]);
    assert.deepEqual(Buffer.from(await f.settle(f.subtle.exportKey("pkcs8", privateKey)) as ArrayBuffer),
      pkcs8(name, der(0x80, new Uint8Array(64).fill(7))));
    for (const format of ["raw-seed", "pkcs8", "jwk"] as const) {
      const material = await f.settle(f.subtle.exportKey(format, privateKey));
      const imported = await f.settle(f.subtle.importKey(format, material, name, true, ["decapsulateKey", "decapsulateBits"]));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, imported)), material);
    }
    for (const format of ["raw-public", "spki", "jwk"] as const) {
      const material = await f.settle(f.subtle.exportKey(format, publicKey));
      const imported = await f.settle(f.subtle.importKey(format, material, name, true, ["encapsulateKey", "encapsulateBits"]));
      assert.deepEqual(await f.settle(f.subtle.exportKey(format, imported)), material);
    }
  });

  test(name + " native generation partitions usages and interoperates with native encapsulation", async () => {
    const f = fixture();
    const pair = await f.settle(f.subtle.generateKey(name.toLowerCase(), true,
      ["decapsulateBits", "encapsulateBits", "encapsulateKey", "decapsulateKey", "encapsulateBits"])) as CryptoKeyPair;
    assert.deepEqual(pair.publicKey.usages, ["encapsulateKey", "encapsulateBits"]);
    assert.deepEqual(pair.privateKey.usages, ["decapsulateKey", "decapsulateBits"]);
    assert.deepEqual(pair.privateKey.algorithm, { name });
    const encoded = await f.settle(f.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
    const nativePrivate = createPrivateKey({ key: Buffer.from(encoded), format: "der", type: "pkcs8" });
    const result = await f.settle(f.subtle.encapsulateBits(name, pair.publicKey));
    assert.deepEqual(Buffer.from(result.sharedKey), decapsulate(nativePrivate, new Uint8Array(result.ciphertext)));
    const nativeResult = encapsulate(createPublicKey(nativePrivate));
    assert.deepEqual(Buffer.from(await f.settle(f.subtle.decapsulateBits(name, pair.privateKey, nativeResult.ciphertext))), nativeResult.sharedKey);
    const restored = await f.settle(f.subtle.importKey("raw-seed", await f.settle(f.subtle.exportKey("raw-seed", pair.privateKey)), name, false, ["decapsulateBits"]));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw-public", await f.settle(f.subtle.getPublicKey(restored, [])))),
      await f.settle(f.subtle.exportKey("raw-public", pair.publicKey)));
  });

  test(name + " decapsulation uses native implicit rejection and rejects only malformed widths", async () => {
    const f = fixture();
    const privateKey = await f.privateKey(name);
    const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["encapsulateBits"]));
    const result = await f.settle(f.subtle.encapsulateBits(name, publicKey));
    const altered = new Uint8Array(result.ciphertext.slice(0)); altered[0] = altered[0]! ^ 1;
    const rejected = await f.settle(f.subtle.decapsulateBits(name, privateKey, altered));
    assert.equal(rejected.byteLength, 32);
    assert.notDeepEqual(rejected, result.sharedKey);
    assert.deepEqual(await f.settle(f.subtle.decapsulateBits(name, privateKey, altered)), rejected);
    const before = f.provider.decapsulations;
    for (const length of [0, altered.byteLength - 1, altered.byteLength + 1]) {
      await assert.rejects(f.settle(f.subtle.decapsulateBits(name, privateKey, new Uint8Array(length))), dom("OperationError"));
    }
    assert.equal(f.provider.decapsulations, before);
  });

  test(name + " key-producing operations import all 256 shared bits and preserve policy", async () => {
    const f = fixture();
    const privateKey = await f.privateKey(name);
    const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["encapsulateKey"]));
    const result = await f.settle(f.subtle.encapsulateKey(name, publicKey, { name: "AES-GCM", length: 128 }, true, ["decrypt", "encrypt"]));
    assert.deepEqual(result.sharedKey.algorithm, { name: "AES-GCM", length: 256 });
    assert.deepEqual(result.sharedKey.usages, ["encrypt", "decrypt"]);
    const decoded = await f.settle(f.subtle.decapsulateKey(name, privateKey, result.ciphertext, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]));
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw-secret", result.sharedKey)), await f.settle(f.subtle.exportKey("raw-secret", decoded)));
    await assert.rejects(f.settle(f.subtle.decapsulateKey(name, privateKey, result.ciphertext,
      { name: "HMAC", hash: "SHA-256", length: 128 }, false, ["sign"])), dom("DataError"));
    const kdf = await f.settle(f.subtle.decapsulateKey(name, privateKey, result.ciphertext, "HKDF", false, ["deriveBits"]));
    assert.deepEqual(kdf.algorithm, { name: "HKDF" });
    assert.equal(kdf.extractable, false);
  });

  test(name + " validates PKCS8 seed/both encodings and rejects inconsistent expanded material", async () => {
    const f = fixture();
    const original = pkcs8(name, der(0x80, new Uint8Array(64).fill(7)));
    const native = createPrivateKey({ key: original, format: "der", type: "pkcs8" });
    const both = native.export({ format: "der", type: "pkcs8" });
    const imported = await f.settle(f.subtle.importKey("pkcs8", both, name, true, ["decapsulateBits"]));
    assert.deepEqual(Buffer.from(await f.settle(f.subtle.exportKey("pkcs8", imported)) as ArrayBuffer), original);
    const corrupt = Buffer.from(both); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", corrupt, name, false, ["decapsulateBits"])), dom("DataError"));
    const size = name === "ML-KEM-512" ? 1632 : name === "ML-KEM-768" ? 2400 : 3168;
    await assert.rejects(f.settle(f.subtle.importKey("pkcs8", pkcs8(name, der(4, new Uint8Array(size))), name, false, ["decapsulateBits"])), dom("NotSupportedError"));
    const before = f.provider.imports;
    for (const bad of [Buffer.concat([original, Buffer.from([0])]), pkcs8(name, der(0x80, new Uint8Array(64)), true),
      pkcs8(name, der(0x80, new Uint8Array(63))), pkcs8(name === "ML-KEM-512" ? "ML-KEM-768" : "ML-KEM-512", der(0x80, new Uint8Array(64)))]) {
      await assert.rejects(f.settle(f.subtle.importKey("pkcs8", bad, name, false, ["decapsulateBits"])), dom("DataError"));
    }
    assert.equal(f.provider.imports, before);
  });

  test(name + " AKP JWK enforces enc usage, exact algorithm and seed/public correspondence", async () => {
    const f = fixture();
    const privateKey = await f.privateKey(name);
    const jwk = await f.settle(f.subtle.exportKey("jwk", privateKey)) as JsonWebKeyObject;
    assert.deepEqual(Object.keys(jwk).sort(), ["alg", "ext", "key_ops", "kty", "priv", "pub"]);
    assert.equal(jwk.kty, "AKP"); assert.equal(jwk.alg, name);
    await f.settle(f.subtle.importKey("jwk", { ...jwk, use: "enc" }, name, true, ["decapsulateKey"]));
    const publicBytes = Buffer.from(jwk.pub!, "base64url"); publicBytes[0] = publicBytes[0]! ^ 1;
    for (const bad of [{ ...jwk, kty: "OKP" }, { ...jwk, alg: undefined }, { ...jwk, priv: "AA" },
      { ...jwk, pub: undefined }, { ...jwk, pub: publicBytes.toString("base64url") }, { ...jwk, ext: false },
      { ...jwk, use: "sig" }, { ...jwk, key_ops: ["encapsulateBits"] }, { ...jwk, key_ops: ["decapsulateBits", "decapsulateBits"] }]) {
      await assert.rejects(f.settle(f.subtle.importKey("jwk", bad, name, true, ["decapsulateBits"])), dom("DataError"));
    }
  });

  test(name + " encoded public-key input checks happen natively on encapsulation", async () => {
    const f = fixture();
    const width = name === "ML-KEM-512" ? 800 : name === "ML-KEM-768" ? 1184 : 1568;
    const key = await f.settle(f.subtle.importKey("raw-public", new Uint8Array(width).fill(255), name, true, ["encapsulateBits"]));
    for (const format of ["raw-public", "spki", "jwk"] as const) {
      const material = await f.settle(f.subtle.exportKey(format, key));
      const imported = await f.settle(f.subtle.importKey(format, material, name, false, ["encapsulateBits"]));
      await assert.rejects(f.settle(f.subtle.encapsulateBits(name, imported)), dom("OperationError"));
    }
    assert.equal(f.provider.encapsulations, 3);
  });
}

test("ML-KEM input views and result buffers retain independent ownership", async () => {
  const f = fixture();
  const seed = new Uint8Array(72).fill(9);
  const key = await f.settle(f.subtle.importKey("raw-seed", new DataView(seed.buffer, 4, 64), "ML-KEM-512", true, ["decapsulateBits"]));
  seed.fill(0);
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.exportKey("raw-seed", key)) as ArrayBuffer), new Uint8Array(64).fill(9));
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateBits"]));
  const publicBytes = new Uint8Array(await f.settle(f.subtle.exportKey("raw-public", publicKey)) as ArrayBuffer);
  const publicCopy = publicBytes.slice();
  const importedPublic = await f.settle(f.subtle.importKey("raw-public", publicBytes, "ML-KEM-512", true, ["encapsulateBits"]));
  publicBytes.fill(0);
  const firstExport = await f.settle(f.subtle.exportKey("raw-public", importedPublic)) as ArrayBuffer;
  assert.deepEqual(new Uint8Array(firstExport), publicCopy);
  new Uint8Array(firstExport).fill(0);
  assert.deepEqual(new Uint8Array(await f.settle(f.subtle.exportKey("raw-public", importedPublic)) as ArrayBuffer), publicCopy);
  const result = await f.settle(f.subtle.encapsulateBits("ML-KEM-512", importedPublic));
  assert.deepEqual(Object.keys(result), ["ciphertext", "sharedKey"]);
  const storage = new Uint8Array(776); storage.set(new Uint8Array(result.ciphertext), 4);
  const pending = f.subtle.decapsulateBits("ML-KEM-512", key, new DataView(storage.buffer, 4, 768));
  assert.equal(f.provider.input!.buffer, storage.buffer);
  assert.equal(f.provider.input!.byteOffset, 4);
  assert.equal(f.provider.input!.byteLength, 768);
  storage.fill(0);
  const decoded = await f.settle(pending);
  assert.deepEqual(decoded, result.sharedKey);
  assert.notEqual(decoded, result.sharedKey);
  assert.notEqual(result.ciphertext, result.sharedKey);
  new Uint8Array(result.sharedKey).fill(0);
  assert.deepEqual(await f.settle(f.subtle.decapsulateBits("ML-KEM-512", key, result.ciphertext)), decoded);
  assert.equal(f.provider.encapsulations, 1);
  assert.equal(f.provider.decapsulations, 2);
});

test("ML-KEM conversion order reads dictionaries twice and captures ciphertext after both normalizations", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const reads: string[] = [];
  const bytes = new Uint8Array(768);
  const kem = { get name(): string { reads.push("kem"); return "ml-kem-512"; } };
  const shared = { get name(): string { reads.push("shared"); bytes[0] = bytes[0]! + 1; return "AES-GCM"; },
    get length(): never { throw new Error("import normalization must not read AES length"); } };
  const usages = { *[Symbol.iterator](): Generator<string> { reads.push("usages"); yield "encrypt"; } };
  f.provider.decapsulated = new Uint8Array(32).fill(5);
  const pending = f.subtle.decapsulateKey(kem, key, bytes, shared, true, usages);
  assert.deepEqual(reads, ["usages", "kem", "kem", "shared", "shared"]);
  assert.equal(f.provider.input![0], 2);
  assert.equal(f.provider.parameters!.name, "ML-KEM-512");
  const result = await f.settle(pending);
  assert.deepEqual(result.algorithm, { name: "AES-GCM", length: 256 });
});

test("ML-KEM methods normalize both algorithms before outer usage failures", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, []));
  await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "unsupported", false, ["encrypt"])), dom("NotSupportedError"));
  await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "AES-GCM", false, ["encrypt"])), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.decapsulateKey("ML-KEM-768", key, new Uint8Array(0), "unsupported", false, ["encrypt"])), dom("NotSupportedError"));
  await assert.rejects(f.settle(f.subtle.decapsulateBits("ML-KEM-768", key, new Uint8Array(0))), dom("InvalidAccessError"));
  assert.equal(f.provider.encapsulations, 0); assert.equal(f.provider.decapsulations, 0);
});

test("ML-KEM methods perform required IDL conversions before normalization", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  await assert.rejects(f.settle(f.subtle.encapsulateBits("unsupported", {})), TypeError);
  await assert.rejects(f.settle(f.subtle.encapsulateKey("unsupported", key, "AES-GCM", false, ["unknown"])), TypeError);
  await assert.rejects(f.settle(f.subtle.decapsulateBits("unsupported", key, new SharedArrayBuffer(768))), TypeError);
  await assert.rejects(f.settle(f.subtle.decapsulateKey("unsupported", key, {}, "AES-GCM", false, ["encrypt"])), TypeError);
  const short = f.subtle as {
    encapsulateBits(...args: unknown[]): Promise<EncapsulatedBits>; encapsulateKey(...args: unknown[]): Promise<EncapsulatedKey>;
    decapsulateBits(...args: unknown[]): Promise<ArrayBuffer>; decapsulateKey(...args: unknown[]): Promise<CryptoKey>;
  };
  await assert.rejects(f.settle(short.encapsulateBits()), TypeError);
  await assert.rejects(f.settle(short.encapsulateKey()), TypeError);
  await assert.rejects(f.settle(short.decapsulateBits()), TypeError);
  await assert.rejects(f.settle(short.decapsulateKey()), TypeError);
});

test("ML-KEM separates key/bits usages and rejects wrong key types before native work", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateKey"]));
  await assert.rejects(f.settle(f.subtle.encapsulateBits("ML-KEM-512", publicKey)), dom("InvalidAccessError"));
  const forgedPublic = createCryptoKey("public", true, new KeyAlgorithm("ML-KEM-512"), ["decapsulateBits"], getCryptoKeySlots(publicKey).handle);
  const forgedPrivate = createCryptoKey("private", true, new KeyAlgorithm("ML-KEM-512"), ["encapsulateBits"], getCryptoKeySlots(key).handle);
  await assert.rejects(f.settle(f.subtle.decapsulateBits("ML-KEM-512", forgedPublic, new Uint8Array(768))), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.encapsulateBits("ML-KEM-512", forgedPrivate)), dom("InvalidAccessError"));
  assert.equal(f.provider.encapsulations, 0); assert.equal(f.provider.decapsulations, 0);
  await assert.rejects(f.settle(f.subtle.generateKey("ML-KEM-512", false, ["verify"])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.generateKey("ML-KEM-512", false, ["encapsulateBits"])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encapsulateBits"])), dom("SyntaxError"));
});

test("ML-KEM maps native failures and malformed output values to OperationError", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateKey", "encapsulateBits"]));
  for (const failure of ["operation", "invalid-key"] as const) {
    f.provider.failure = { failure };
    await assert.rejects(f.settle(f.subtle.encapsulateBits("ML-KEM-512", publicKey)), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.decapsulateBits("ML-KEM-512", key, new Uint8Array(768))), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "AES-GCM", false, ["encrypt"])), dom("OperationError"));
    await assert.rejects(f.settle(f.subtle.decapsulateKey("ML-KEM-512", key, new Uint8Array(768), "AES-GCM", false, ["encrypt"])), dom("OperationError"));
  }
  f.provider.failure = undefined;
  for (const result of [{ sharedKey: new Uint8Array(31), ciphertext: new Uint8Array(768) },
    { sharedKey: new Uint8Array(32), ciphertext: new Uint8Array(767) }]) {
    f.provider.encapsulated = result;
    await assert.rejects(f.settle(f.subtle.encapsulateBits("ML-KEM-512", publicKey)), dom("OperationError"));
  }
  f.provider.decapsulated = new Uint8Array(33);
  await assert.rejects(f.settle(f.subtle.decapsulateBits("ML-KEM-512", key, new Uint8Array(768))), dom("OperationError"));
});

test("ML-KEM key methods call internal operations and importers despite public overrides", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateKey"]));
  f.subtle.encapsulateBits = (): never => { throw new Error("public encapsulateBits override invoked"); };
  f.subtle.decapsulateBits = (): never => { throw new Error("public decapsulateBits override invoked"); };
  f.subtle.importKey = (): never => { throw new Error("public importKey override invoked"); };
  const result = await f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "AES-GCM", true, ["encrypt"]));
  const restored = await f.settle(f.subtle.decapsulateKey("ML-KEM-512", key, result.ciphertext, "AES-GCM", true, ["encrypt"]));
  assert.deepEqual(await f.settle(f.subtle.exportKey("raw-secret", result.sharedKey)), await f.settle(f.subtle.exportKey("raw-secret", restored)));
  assert.equal(f.provider.encapsulations, 1); assert.equal(f.provider.decapsulations, 1);
});

test("ML-KEM secret target checks follow the KEM operation and do not truncate bytes", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateKey"]));
  await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "AES-GCM", false, [])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "HKDF", true, ["deriveBits"])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, "ML-KEM-512", false, ["decapsulateBits"])), dom("NotSupportedError"));
  assert.equal(f.provider.encapsulations, 3);
});

test("ML-KEM getPublicKey ignores private extractability and allows only encapsulation usages", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512", false);
  key.algorithm.name = "AES-GCM"; key.usages.length = 0;
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateBits", "encapsulateKey", "encapsulateKey"]));
  assert.deepEqual(publicKey.algorithm, { name: "ML-KEM-512" });
  assert.deepEqual(publicKey.usages, ["encapsulateKey", "encapsulateBits"]);
  assert.equal(publicKey.extractable, true);
  assert.equal(f.provider.publics, 1);
  assert.notEqual(getCryptoKeySlots(key).handle, getCryptoKeySlots(publicKey).handle);
  await assert.rejects(f.settle(f.subtle.getPublicKey(key, ["decapsulateBits"])), dom("SyntaxError"));
  await assert.rejects(f.settle(f.subtle.getPublicKey(publicKey, [])), dom("InvalidAccessError"));
});

test("ML-KEM rejects legacy raw and raw-secret formats while accepting empty public usages", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, []));
  for (const format of ["raw", "raw-private", "raw-secret"] as const) {
    await assert.rejects(f.settle(f.subtle.importKey(format, new Uint8Array(64), "ML-KEM-512", false, ["decapsulateBits"])), dom("NotSupportedError"));
    await assert.rejects(f.settle(f.subtle.exportKey(format, key)), dom("NotSupportedError"));
  }
  await assert.rejects(f.settle(f.subtle.exportKey("raw-public", key)), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.exportKey("raw-seed", publicKey)), dom("InvalidAccessError"));
  await assert.rejects(f.settle(f.subtle.importKey("raw-seed", new Uint8Array(64), "ML-KEM-512", false, [])), dom("SyntaxError"));
  const encoded = await f.settle(f.subtle.exportKey("raw-public", publicKey));
  assert.deepEqual((await f.settle(f.subtle.importKey("raw-public", encoded, "ML-KEM-512", false, []))).usages, []);
});

test("ML-KEM promise settlement uses the crypto task queue without delaying native work", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateBits"]));
  let settled = false;
  const pending = f.subtle.encapsulateBits("ML-KEM-512", publicKey).then(result => { settled = true; return result; });
  assert.equal(f.provider.encapsulations, 1);
  await Promise.resolve();
  assert.equal(settled, false);
  f.scheduler.runPending();
  assert.equal((await pending).sharedKey.byteLength, 32);
  assert.equal(settled, true);
});

for (const target of [
  { name: "AES-OCB", algorithm: { name: "AES-OCB" }, usages: ["encrypt", "decrypt"] },
  { name: "ChaCha20-Poly1305", algorithm: { name: "ChaCha20-Poly1305" }, usages: ["encrypt", "decrypt"] },
  { name: "KMAC128", algorithm: { name: "KMAC128", length: 249 }, usages: ["sign", "verify"] },
  { name: "KMAC256", algorithm: { name: "KMAC256", length: 256 }, usages: ["sign", "verify"] },
  { name: "HMAC with SHA3-512", algorithm: { name: "HMAC", hash: "SHA3-512", length: 255 }, usages: ["sign", "verify"] },
]) {
  test("ML-KEM imports its complete shared secret into " + target.name, async () => {
    const f = fixture();
    const privateKey = await f.privateKey("ML-KEM-768");
    const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["encapsulateKey"]));
    const result = await f.settle(f.subtle.encapsulateKey("ML-KEM-768", publicKey, target.algorithm, true, target.usages));
    const decoded = await f.settle(f.subtle.decapsulateKey("ML-KEM-768", privateKey, result.ciphertext, target.algorithm, true, target.usages));
    const bytes = await f.settle(f.subtle.exportKey("raw-secret", result.sharedKey)) as ArrayBuffer;
    assert.equal(bytes.byteLength, 32);
    assert.deepEqual(await f.settle(f.subtle.exportKey("raw-secret", decoded)), bytes);
    assert.deepEqual(decoded.algorithm, result.sharedKey.algorithm);
    assert.deepEqual(decoded.usages, target.usages);
  });
}

for (const name of ["Argon2d", "Argon2i", "Argon2id"] as const) {
  test("ML-KEM imports nonextractable " + name + " material through raw-secret", async () => {
    const f = fixture();
    const privateKey = await f.privateKey("ML-KEM-512");
    const publicKey = await f.settle(f.subtle.getPublicKey(privateKey, ["encapsulateKey"]));
    const result = await f.settle(f.subtle.encapsulateKey("ML-KEM-512", publicKey, name, false, ["deriveBits"]));
    const imported = f.provider.imported;
    assert.ok(imported !== undefined && imported.format === "raw" && imported.family === "secret");
    const material = imported.bytes.slice();
    const decoded = await f.settle(f.subtle.decapsulateKey("ML-KEM-512", privateKey, result.ciphertext, name, false, ["deriveBits"]));
    const decapsulated = f.provider.imported;
    assert.ok(decapsulated !== undefined && decapsulated.format === "raw" && decapsulated.family === "secret");
    assert.equal(material.byteLength, 32);
    assert.deepEqual(decapsulated.bytes, material);
    assert.deepEqual(decoded.algorithm, { name });
    assert.equal(decoded.extractable, false);
    await assert.rejects(f.settle(f.subtle.exportKey("raw-secret", decoded)), dom("NotSupportedError"));
  });
}

test("ML-KEM private JWK native seed-import failure precedes its public-field check", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const material = await f.settle(f.subtle.exportKey("jwk", key)) as JsonWebKeyObject;
  f.provider.failure = { failure: "operation" };
  await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...material, pub: undefined }, "ML-KEM-512", false, ["decapsulateBits"])), dom("OperationError"));
  f.provider.failure = undefined;
  await assert.rejects(f.settle(f.subtle.importKey("jwk", { ...material, pub: undefined }, "ML-KEM-512", false, ["decapsulateBits"])), dom("DataError"));
});

test("ML-KEM wrapping uses internal import/export and preserves private KEM usages", async () => {
  const f = fixture();
  const key = await f.privateKey("ML-KEM-512");
  const publicKey = await f.settle(f.subtle.getPublicKey(key, ["encapsulateBits"]));
  const wrapping = await f.settle(f.subtle.importKey("raw-secret", new Uint8Array(16), "AES-OCB", false, ["wrapKey", "unwrapKey"]));
  const algorithm = { name: "AES-OCB", iv: new Uint8Array(12) };
  f.subtle.exportKey = (): never => { throw new Error("public exportKey override invoked"); };
  f.subtle.importKey = (): never => { throw new Error("public importKey override invoked"); };
  for (const format of ["jwk", "raw-seed", "pkcs8"] as const) {
    const wrapped = await f.settle(f.subtle.wrapKey(format, key, wrapping, algorithm));
    const restored = await f.settle(f.subtle.unwrapKey(format, wrapped, wrapping, algorithm, "ML-KEM-512", false, ["decapsulateBits"]));
    assert.deepEqual(restored.usages, ["decapsulateBits"]);
    const result = await f.settle(f.subtle.encapsulateBits("ML-KEM-512", publicKey));
    assert.deepEqual(await f.settle(f.subtle.decapsulateBits("ML-KEM-512", restored, result.ciphertext)), result.sharedKey);
  }
});
