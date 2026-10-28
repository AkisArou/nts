// Modern Algorithms §§17.2–17.4; Web Crypto §§14.3.7–9 and 18.4.4.
// https://wicg.github.io/webcrypto-modern-algos/#argon2
// RFC 9106 §5.1–5.3 supply the independent expected outputs below.
// https://www.rfc-editor.org/rfc/rfc9106.html#section-5
import assert from "node:assert/strict";
import { argon2Sync } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { Argon2Params, normalizeAlgorithm, supportsCryptoOperation } from "../src/crypto/algorithms.ts";
import type { Argon2AlgorithmName } from "../src/crypto/algorithms.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoArgon2Parameters, CryptoDerivationParameters, CryptoFailure, CryptoKeyHandle,
  CryptoKeyImport, CryptoKeyRecord,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";
import { x25519PrivateJwk, x25519PublicJwk, x25519Secret } from "./okp-fixtures.ts";

const names = ["Argon2d", "Argon2i", "Argon2id"] as const;
const expectedHex = [
  "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb",
  "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8",
  "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
] as const;

function parameters(name: Argon2AlgorithmName): CryptoArgon2Parameters {
  return {
    name, nonce: new Uint8Array(16).fill(2), parallelism: 4, memory: 32, passes: 3,
    version: 0x13, secretValue: new Uint8Array(8).fill(3),
    associatedData: new Uint8Array(12).fill(4), byteLength: 32,
  };
}

function oracle(name: Argon2AlgorithmName, password: Uint8Array, input = parameters(name), byteLength = 32): Uint8Array {
  const algorithm = name === "Argon2d" ? "argon2d" : name === "Argon2i" ? "argon2i" : "argon2id";
  return new Uint8Array(argon2Sync(algorithm, {
    message: password, nonce: input.nonce, parallelism: input.parallelism,
    memory: input.memory, passes: input.passes, secret: input.secretValue,
    associatedData: input.associatedData, tagLength: byteLength,
  }));
}

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function dom(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}

function owned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.buffer.byteLength, bytes.byteLength);
}

class RecordingProvider extends NodeCryptoProvider {
  derives = 0;
  imports = 0;
  lastParameters: CryptoDerivationParameters | undefined;
  result: Uint8Array | CryptoFailure | undefined;
  importResult: CryptoKeyRecord | CryptoFailure | undefined;

  override derive(input: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    this.derives++;
    this.lastParameters = input;
    return this.result ?? super.derive(input, key);
  }

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    return this.importResult ?? super.importKey(input);
  }
}

class CountingScheduler extends VirtualScheduler {
  enqueues = 0;
  override enqueue(task: () => void): void { this.enqueues++; super.enqueue(task); }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new CountingScheduler();
  const subtle = createCrypto({ fill(): never { throw new Error("Argon2 must not request random bytes"); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  async function key(name: Argon2AlgorithmName, usages: KeyUsage[] = ["deriveKey", "deriveBits"], password = new Uint8Array(32).fill(1)) {
    const key = await settle(subtle.importKey("raw-secret", password, name, false, usages));
    provider.derives = 0;
    provider.imports = 0;
    scheduler.enqueues = 0;
    return key;
  }
  return { provider, scheduler, subtle, settle, key };
}

for (const [index, name] of names.entries()) {
  test(`${name} native derivation matches RFC 9106 and owns each output`, () => {
    const provider = new NodeCryptoProvider();
    const passwordBacking = new Uint8Array(40).fill(0xa5);
    const password = passwordBacking.subarray(3, 35);
    password.fill(1);
    const key = success(provider.importKey({ format: "raw", family: "secret", bytes: password }));
    passwordBacking.fill(0);
    const input = parameters(name);
    const beforeNonce = input.nonce.slice();
    const beforeSecret = input.secretValue!.slice();
    const beforeAssociated = input.associatedData!.slice();
    const expected = new Uint8Array(Buffer.from(expectedHex[index]!, "hex"));
    const first = success(provider.derive(input, key.handle));
    const second = success(provider.derive(input, key.handle));
    owned(first); owned(second);
    assert.deepEqual(first, expected);
    assert.deepEqual(second, expected);
    assert.notEqual(first.buffer, second.buffer);
    first.fill(0);
    assert.deepEqual(second, expected);
    assert.deepEqual(input.nonce, beforeNonce);
    assert.deepEqual(input.secretValue, beforeSecret);
    assert.deepEqual(input.associatedData, beforeAssociated);
    assert.deepEqual(success(provider.derive(input, key.handle)), expected);
  });

  test(`${name} returns native validation and handle failures as values`, () => {
    const provider = new NodeCryptoProvider();
    const key = success(provider.importKey({ format: "raw", family: "secret", bytes: new Uint8Array() }));
    const input = parameters(name);
    for (const invalid of [
      { nonce: new Uint8Array(7) }, { parallelism: 0 }, { parallelism: 0x1000000 },
      { memory: 31 }, { passes: 0 }, { byteLength: 3 }, { byteLength: 4.5 },
    ]) {
      assert.deepEqual(provider.derive({ ...input, ...invalid }, key.handle), { failure: "operation" });
    }
    const pair = success(provider.generateKeyPair({ family: "OKP", namedCurve: "Ed25519" }));
    for (const handle of [{} as CryptoKeyHandle, pair.privateKey.handle, pair.publicKey.handle]) {
      assert.deepEqual(provider.derive(input, handle), { failure: "invalid-key" });
    }
    const output = success(provider.derive({ ...input, nonce: new Uint8Array(8), byteLength: 4 }, key.handle));
    owned(output);
    assert.equal(output.byteLength, 4);
  });

  test(`${name} imports name-only nonextractable raw-secret keys with owned material`, async () => {
    const f = fixture();
    const storage = new Uint8Array([99, 0, 0xff, 0x80, 88]);
    const source = new DataView(storage.buffer, 1, 3);
    const usages: KeyUsage[] = ["deriveBits", "deriveKey", "deriveBits"];
    const pending = f.subtle.importKey("raw-secret", source, {
      name: name.toLowerCase(),
      get memory(): never { throw new Error("Import must not inspect derive parameters"); },
    }, false, usages);
    assert.equal(f.provider.imports, 1);
    storage.fill(0);
    usages.length = 0;
    const key = await f.settle(pending);
    assert.equal(key.type, "secret");
    assert.equal(key.extractable, false);
    assert.deepEqual(key.algorithm, { name });
    assert.deepEqual(key.usages, ["deriveKey", "deriveBits"]);
    assert.deepEqual(success(f.provider.exportKey(getCryptoKeySlots(key).handle, "raw")), new Uint8Array([0, 255, 128]));
    await assert.rejects(f.settle(f.subtle.exportKey("raw-secret", key)), dom("NotSupportedError"));
    const empty = await f.key(name, ["deriveBits"], new Uint8Array());
    assert.deepEqual(empty.algorithm, { name });
    assert.deepEqual(success(f.provider.exportKey(getCryptoKeySlots(empty).handle, "raw")), new Uint8Array());
  });

  test(`${name} enforces raw-secret format, usages and extractability before native import`, async () => {
    const f = fixture();
    for (const format of ["raw", "spki", "pkcs8", "jwk"]) {
      const data = format === "jwk" ? {} : new Uint8Array();
      await assert.rejects(f.settle(f.subtle.importKey(format, data, name, true, ["encrypt"])), dom("NotSupportedError"));
    }
    for (const usage of ["encrypt", "decrypt", "sign", "verify", "wrapKey", "unwrapKey"]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw-secret", new Uint8Array(), name, false, [usage])), dom("SyntaxError"));
    }
    await assert.rejects(f.settle(f.subtle.importKey("raw-secret", new Uint8Array(), name, true, ["deriveBits"])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 0);
    await assert.rejects(f.settle(f.subtle.importKey("raw-secret", new Uint8Array(), name, false, [])), dom("SyntaxError"));
    assert.equal(f.provider.imports, 1);
    for (const failure of ["invalid-key", "operation"] as const) {
      f.provider.importResult = { failure };
      await assert.rejects(f.settle(f.subtle.importKey("raw-secret", new Uint8Array(), name, false, [])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    assert.equal(f.provider.imports, 3);
  });

  test(`${name} public deriveBits uses one native call and a queued crypto result`, async () => {
    const f = fixture();
    const key = await f.key(name);
    for (const version of [undefined, 0x13]) {
      const before = f.provider.derives;
      const pending = f.subtle.deriveBits({ ...parameters(name), version }, key, 256);
      assert.equal(f.provider.derives, before + 1);
      assert.equal(f.scheduler.enqueues, before + 1);
      let settled = false;
      void pending.then(() => { settled = true; });
      await Promise.resolve();
      assert.equal(settled, false);
      const output = new Uint8Array(await f.settle(pending));
      assert.equal(settled, true);
      assert.equal(Buffer.from(output).toString("hex"), expectedHex[index]);
      assert.equal(f.provider.lastParameters?.name, name);
      const native = f.provider.lastParameters as CryptoArgon2Parameters;
      assert.equal(native.version, 0x13);
      assert.equal(native.byteLength, 32);
    }
  });

  test(`${name} validates operation bounds without calling the provider`, async () => {
    const f = fixture();
    const key = await f.key(name);
    for (const length of [null, undefined, 0, 8, 24, 31, 33, 255]) {
      await assert.rejects(f.settle(f.subtle.deriveBits(parameters(name), key, length)), dom("OperationError"));
    }
    for (const invalid of [
      { version: 0 }, { version: 0x10 }, { version: 0x14 }, { parallelism: 0 },
      { parallelism: 0x1000000 }, { memory: 31 }, { passes: 0 },
    ]) {
      await assert.rejects(f.settle(f.subtle.deriveBits({ ...parameters(name), ...invalid }, key, 256)), dom("OperationError"));
    }
    assert.equal(f.provider.derives, 0);
    const output = await f.settle(f.subtle.deriveBits({ ...parameters(name), nonce: new Uint8Array(8), parallelism: 1, memory: 8, passes: 1 }, key, 32));
    assert.equal(output.byteLength, 4);
    assert.equal(f.provider.derives, 1);
  });

  test(`${name} leaves nonce failure to the native operation and validates its output`, async () => {
    const f = fixture();
    const key = await f.key(name);
    await assert.rejects(f.settle(f.subtle.deriveBits({ ...parameters(name), nonce: new Uint8Array(7) }, key, 256)), dom("OperationError"));
    assert.equal(f.provider.derives, 1);
    for (const result of [{ failure: "operation" }, { failure: "invalid-key" }, new Uint8Array(31), new Uint8Array(33)] as const) {
      f.provider.result = result;
      await assert.rejects(f.settle(f.subtle.deriveBits(parameters(name), key, 256)), dom("OperationError"));
    }
    f.provider.result = new Uint8Array(32);
    assert.equal((await f.settle(f.subtle.deriveBits(parameters(name), key, 256))).byteLength, 32);
  });

  test(`${name} checks key algorithm and usage before operation bounds`, async () => {
    const f = fixture();
    const key = await f.key(name, ["deriveKey"]);
    await assert.rejects(f.settle(f.subtle.deriveBits({ ...parameters(name), memory: 0 }, key, 0)), dom("InvalidAccessError"));
    const other = await f.key(name === "Argon2d" ? "Argon2i" : "Argon2d");
    await assert.rejects(f.settle(f.subtle.deriveBits({ ...parameters(name), memory: 0 }, other, 0)), dom("InvalidAccessError"));
    assert.equal(f.provider.derives, 0);
  });

  test(`${name} preserves binary and empty inputs, optional defaults, exact views and unrounded memory`, async () => {
    const f = fixture();
    const backing = new Uint8Array([99, 0, 128, 255, 1, 0, 2, 3, 4, 88]);
    for (const password of [new Uint8Array(), new Uint8Array([0, 128, 255, 0])]) {
      const key = await f.key(name, ["deriveBits"], password);
      const input = { ...parameters(name), nonce: backing.subarray(1, 9), secretValue: undefined, associatedData: undefined, memory: 33 };
      const result = await f.settle(f.subtle.deriveBits({ ...input, nonce: new DataView(backing.buffer, 1, 8) }, key, 520));
      assert.deepEqual(new Uint8Array(result), oracle(name, password, input, 65));
      const native = f.provider.lastParameters as CryptoArgon2Parameters;
      assert.equal(native.memory, 33);
      assert.equal(native.nonce.byteLength, 8);
      assert.equal(native.nonce.buffer, backing.buffer);
      assert.equal(native.nonce.byteOffset, 1);
      const empty = await f.settle(f.subtle.deriveBits({ ...input, secretValue: new Uint8Array(), associatedData: new Uint8Array() }, key, 520));
      assert.deepEqual(empty, result);
    }
  });

  test(`${name} derives usable AES and HMAC keys with one derivation and one import`, async () => {
    const f = fixture();
    const base = await f.key(name, ["deriveKey"]);
    for (const target of [{ name: "AES-GCM", length: 256 }, { name: "HMAC", hash: "SHA-256", length: 256 }]) {
      const beforeDerives = f.provider.derives;
      const beforeImports = f.provider.imports;
      const usages = target.name === "HMAC" ? ["sign"] : ["encrypt"];
      const key = await f.settle(f.subtle.deriveKey(parameters(name), base, target, true, usages));
      assert.equal(f.provider.derives, beforeDerives + 1);
      assert.equal(f.provider.imports, beforeImports + 1);
      assert.equal(Buffer.from(await f.settle(f.subtle.exportKey("raw", key)) as ArrayBuffer).toString("hex"), expectedHex[index]);
    }
    for (const target of ["Argon2d", "Argon2i", "Argon2id", "HKDF", "PBKDF2"]) {
      const before = f.provider.derives;
      await assert.rejects(f.settle(f.subtle.deriveKey(parameters(name), base, target, false, ["deriveBits"])), dom("OperationError"));
      assert.equal(f.provider.derives, before);
    }
  });

  test(`${name} derives an Argon2 target from the full X25519 agreement secret`, async () => {
    const f = fixture();
    const privateKey = await f.settle(f.subtle.importKey("jwk", x25519PrivateJwk("alice"), "X25519", false, ["deriveKey"]));
    const publicKey = await f.settle(f.subtle.importKey("jwk", x25519PublicJwk("bob"), "X25519", false, []));
    const key = await f.settle(f.subtle.deriveKey({ name: "X25519", public: publicKey }, privateKey, name, false, ["deriveBits"]));
    assert.deepEqual(key.algorithm, { name });
    assert.equal(key.extractable, false);
    assert.deepEqual(success(f.provider.exportKey(getCryptoKeySlots(key).handle, "raw")), x25519Secret());
    assert.deepEqual(new Uint8Array(await f.settle(f.subtle.deriveBits(parameters(name), key, 256))), oracle(name, x25519Secret()));
  });

  test(`${name} unwraps raw-secret material only after authentication and validates import policy`, async () => {
    const f = fixture();
    const wrapping = await f.settle(f.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", false, ["encrypt", "unwrapKey"]));
    const cipher = { name: "AES-GCM", iv: new Uint8Array(12) };
    const encrypted = await f.settle(f.subtle.encrypt(cipher, wrapping, new Uint8Array(32).fill(1)));
    const key = await f.settle(f.subtle.unwrapKey("raw-secret", encrypted, wrapping, cipher, name, false, ["deriveBits"]));
    assert.equal(Buffer.from(await f.settle(f.subtle.deriveBits(parameters(name), key, 256))).toString("hex"), expectedHex[index]);
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw-secret", encrypted, wrapping, cipher, name, true, ["deriveBits"])), dom("SyntaxError"));
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw", encrypted, wrapping, cipher, name, false, ["deriveBits"])), dom("NotSupportedError"));
    const damaged = new Uint8Array(encrypted.slice(0));
    damaged[0]! ^= 1;
    await assert.rejects(f.settle(f.subtle.unwrapKey("raw-secret", damaged, wrapping, cipher, name, true, ["sign"])), dom("OperationError"));
  });
}

test("Argon2 registers only import, derivation and the null key-length operation", () => {
  for (const name of names) {
    for (const operation of ["importKey", "deriveBits", "get key length"] as const) assert.equal(supportsCryptoOperation(name.toLowerCase(), operation), true);
    for (const operation of ["generateKey", "exportKey", "digest", "sign", "verify", "encrypt", "decrypt", "wrapKey", "unwrapKey"] as const) {
      assert.equal(supportsCryptoOperation(name, operation), false);
    }
  }
});

test("Argon2 dictionary conversion is lexicographic and preserves the first normalized name", () => {
  const reads: string[] = [];
  let nameReads = 0;
  const result = normalizeAlgorithm({
    get name() { reads.push("name"); return ++nameReads === 1 ? "aRgOn2Id" : "HMAC"; },
    get associatedData() { reads.push("associatedData"); return new Uint8Array([4]); },
    get memory() { reads.push("memory"); return "32.9"; },
    get nonce() { reads.push("nonce"); return new Uint8Array(8); },
    get parallelism() { reads.push("parallelism"); return 4; },
    get passes() { reads.push("passes"); return { valueOf() { reads.push("passes.valueOf"); return 3.8; } }; },
    get secretValue() { reads.push("secretValue"); return new Uint8Array([3]); },
    get version() { reads.push("version"); return "19.9"; },
  }, "deriveBits");
  assert.ok(result instanceof Argon2Params);
  assert.equal(result.name, "Argon2id");
  assert.equal(result.memory, 32);
  assert.equal(result.passes, 3);
  assert.equal(result.version, 19);
  assert.deepEqual(reads, ["name", "name", "associatedData", "memory", "nonce", "parallelism", "passes", "passes.valueOf", "secretValue", "version"]);
});

test("Argon2 validates required members, unsigned-long and octet ranges during normalization", () => {
  const base = parameters("Argon2id");
  for (const member of ["memory", "nonce", "parallelism", "passes"] as const) {
    assert.throws(() => normalizeAlgorithm({ ...base, [member]: undefined }, "deriveBits"), TypeError);
  }
  for (const member of ["memory", "parallelism", "passes", "version"] as const) {
    for (const value of [NaN, Infinity, -Infinity, -1, 1n, Symbol("1"), member === "version" ? 256 : 0x100000000]) {
      assert.throws(() => normalizeAlgorithm({ ...base, [member]: value }, "deriveBits"), TypeError);
    }
    for (const value of [-0, -0.9, null, false]) {
      const result = normalizeAlgorithm({ ...base, [member]: value }, "deriveBits");
      assert.ok(result instanceof Argon2Params);
      assert.equal(result[member], 0);
      assert.equal(Object.is(result[member], -0), false);
    }
  }
  const maximum = normalizeAlgorithm({ ...base, memory: 0xffffffff, parallelism: 0xffffffff, passes: 0xffffffff, version: 255 }, "deriveBits");
  assert.ok(maximum instanceof Argon2Params);
  assert.equal(maximum.memory, 0xffffffff);
  assert.equal(maximum.parallelism, 0xffffffff);
  assert.equal(maximum.passes, 0xffffffff);
  assert.equal(maximum.version, 255);
});

test("Argon2 rejects invalid BufferSources and preserves author exceptions", () => {
  const shared = new SharedArrayBuffer(8);
  const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
  for (const member of ["nonce", "secretValue", "associatedData"] as const) {
    for (const value of [null, {}, [1], shared, new Uint8Array(shared), resizable, new DataView(resizable)]) {
      assert.throws(() => normalizeAlgorithm({ ...parameters("Argon2id"), [member]: value }, "deriveBits"), TypeError);
    }
  }
  const failure = new Error("author memory conversion");
  assert.throws(() => normalizeAlgorithm({
    name: "Argon2id", memory: { valueOf(): never { throw failure; } },
    get nonce(): never { throw new Error("Must not read nonce"); },
  }, "deriveBits"), (error) => error === failure);
});

test("Argon2 snapshots after all dictionary conversions and borrows when no later script can run", () => {
  for (const copy of [false, true]) {
    const nonce = new Uint8Array(8).fill(1);
    const secret = new Uint8Array([2]);
    const associated = new Uint8Array([3]);
    const result = normalizeAlgorithm({
      ...parameters("Argon2id"), nonce, secretValue: secret, associatedData: associated,
      get version() { nonce[0] = 9; secret[0] = 8; associated[0] = 7; return 19; },
    }, "deriveBits", copy);
    assert.ok(result instanceof Argon2Params);
    assert.equal(result.nonce[0], 9);
    assert.equal(result.secretValue![0], 8);
    assert.equal(result.associatedData![0], 7);
    assert.equal(result.nonce.buffer === nonce.buffer, !copy);
    assert.equal(result.secretValue!.buffer === secret.buffer, !copy);
    assert.equal(result.associatedData!.buffer === associated.buffer, !copy);
  }
});

test("Argon2 deriveKey captures all input bytes before target getters and calls internal operations", async () => {
  const f = fixture();
  const base = await f.key("Argon2id", ["deriveKey"]);
  const input = parameters("Argon2id");
  const target = {
    get name() { input.nonce.fill(0); input.secretValue!.fill(0); input.associatedData!.fill(0); return "AES-GCM"; },
    length: 256,
  };
  f.subtle.importKey = (): never => { throw new Error("Must not invoke public importKey"); };
  f.subtle.deriveBits = (): never => { throw new Error("Must not invoke public deriveBits"); };
  const key = await f.settle(f.subtle.deriveKey(input, base, target, true, ["encrypt"]));
  assert.equal(Buffer.from(await f.settle(f.subtle.exportKey("raw", key)) as ArrayBuffer).toString("hex"), expectedHex[2]);
  assert.equal(f.provider.derives, 1);
  assert.equal(f.provider.imports, 1);
});
