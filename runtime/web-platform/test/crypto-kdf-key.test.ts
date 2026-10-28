// Specification controls: Web Cryptography §§9, 13–17, 33.4.2–3, 34.4.2–3.
// https://w3c.github.io/webcrypto/#hkdf-operations-import-key
// https://w3c.github.io/webcrypto/#pbkdf2-operations-import-key
// Native primitives only; no Node WebCrypto or descriptor/prototype spoofing.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import type { KdfAlgorithmName } from "../src/crypto/algorithms.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import { getCryptoKeySlots } from "../src/crypto/crypto-key.ts";
import type { KeyUsage } from "../src/crypto/crypto-key.ts";
import { getKdfKeyLength } from "../src/crypto/kdf.ts";
import type { CryptoFailure, CryptoKeyImport, CryptoKeyRecord } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  imports = 0;
  importInput: CryptoKeyImport | undefined;
  importFailure: CryptoFailure | undefined;
  importRecord: CryptoKeyRecord | undefined;

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    this.importInput = input;
    return this.importFailure ?? this.importRecord ?? super.importKey(input);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  let fills = 0;
  const subtle = createCrypto({ fill(bytes: Uint8Array): void { fills++; bytes.fill(0x37); } }, provider, scheduler).subtle;
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  return { provider, scheduler, subtle, settle, fills: () => fills };
}

function dom(name: string): (error: unknown) => boolean {
  return error => error instanceof DOMException && error.name === name;
}

const names: readonly KdfAlgorithmName[] = ["HKDF", "PBKDF2"];

for (const name of names) {
  test(name + " imports nonextractable raw secrets with name-only algorithm and normalized usages", async () => {
    const f = fixture();
    const data = new Uint8Array([0, 1, 255, 0]);
    const key = await f.settle(f.subtle.importKey("raw", data, name.toLowerCase(), false, ["deriveBits", "deriveKey", "deriveBits"]));
    assert.equal(key.type, "secret");
    assert.equal(key.extractable, false);
    assert.deepEqual(key.algorithm, { name });
    assert.deepEqual(Object.keys(key.algorithm), ["name"]);
    assert.deepEqual(key.usages, ["deriveKey", "deriveBits"]);
    assert.equal(f.provider.imports, 1);
    assert.equal(f.fills(), 0);
    const input = f.provider.importInput;
    assert.ok(input?.format === "raw" && input.family === "secret");
    assert.equal(input.bytes, data);
    assert.deepEqual(f.provider.exportKey(getCryptoKeySlots(key).handle, "raw"), data);
  });

  test(name + " import ignores operation parameters and does not attach a hash to the key", async () => {
    const f = fixture();
    const algorithm = {
      name,
      get hash(): never { throw new Error("import must not inspect hash"); },
      get salt(): never { throw new Error("import must not inspect salt"); },
      get info(): never { throw new Error("import must not inspect info"); },
      get iterations(): never { throw new Error("import must not inspect iterations"); },
      get length(): never { throw new Error("import must not inspect length"); },
    };
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array([1]), algorithm, false, ["deriveKey"]));
    assert.deepEqual(key.algorithm, { name });
    assert.deepEqual(key.usages, ["deriveKey"]);
  });

  test(name + " accepts empty and detached raw key material", async () => {
    const f = fixture();
    const detached = new ArrayBuffer(3);
    structuredClone(detached, { transfer: [detached] });
    for (const data of [new Uint8Array(), new ArrayBuffer(0), detached]) {
      const key = await f.settle(f.subtle.importKey("raw", data, name, false, ["deriveBits"]));
      assert.equal(key.type, "secret");
      assert.equal(key.extractable, false);
      assert.deepEqual(key.algorithm, { name });
      assert.deepEqual(f.provider.exportKey(getCryptoKeySlots(key).handle, "raw"), new Uint8Array());
    }
    assert.equal(f.provider.imports, 3);
  });

  test(name + " rejects non-raw formats before usage and extractability policy", async () => {
    const f = fixture();
    for (const format of ["spki", "pkcs8", "jwk"] as const) {
      const data = format === "jwk" ? {} : new Uint8Array();
      for (const usages of [["encrypt"], [], ["deriveBits"]]) {
        await assert.rejects(f.settle(f.subtle.importKey(format, data, name, true, usages)), dom("NotSupportedError"));
      }
    }
    assert.equal(f.provider.imports, 0);
  });

  test(name + " rejects invalid usages and extractability before importing", async () => {
    const f = fixture();
    for (const usage of ["encrypt", "decrypt", "sign", "verify", "wrapKey", "unwrapKey"]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), name, false, [usage])), dom("SyntaxError"));
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), name, true, [usage])), dom("SyntaxError"));
    }
    for (const extractable of [true, 1, "true", {}]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), name, extractable, ["deriveBits"])), dom("SyntaxError"));
    }
    assert.equal(f.provider.imports, 0);
    const key = await f.settle(f.subtle.importKey("raw", new Uint8Array(), name, false, ["deriveBits"]));
    assert.deepEqual(key.usages, ["deriveBits"]);
    assert.equal(f.provider.imports, 1);
  });

  test(name + " checks empty secret usages after native import and preserves failure precedence", async () => {
    const f = fixture();
    for (const data of [new Uint8Array(), new Uint8Array([1])]) {
      await assert.rejects(f.settle(f.subtle.importKey("raw", data, name, false, [])), dom("SyntaxError"));
    }
    assert.equal(f.provider.imports, 2);
    for (const failure of ["invalid-key", "operation"] as const) {
      f.provider.importFailure = { failure };
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), name, false, [])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    assert.equal(f.provider.imports, 4);
  });

  test(name + " maps both native import failure values at the import step", async () => {
    const f = fixture();
    for (const failure of ["invalid-key", "operation"] as const) {
      f.provider.importFailure = { failure };
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array([1]), name, false, ["deriveBits"])), dom(failure === "invalid-key" ? "DataError" : "OperationError"));
    }
    assert.equal(f.provider.imports, 2);
  });

  test(name + " checks actual native secret metadata including zero-bit material", async () => {
    const f = fixture();
    const real = new NodeCryptoProvider().importKey({ format: "raw", family: "secret", bytes: new Uint8Array([1]) });
    assert.ok(!("failure" in real));
    for (const info of [
      { family: "secret", type: "secret", length: 0 },
      { family: "secret", type: "secret", length: 7 },
      { family: "secret", type: "secret", length: 16 },
      { family: "secret", type: "secret", length: NaN },
      { family: "OKP", type: "public", namedCurve: "Ed25519" },
      { family: "RSA", type: "private", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    ] as const) {
      f.provider.importRecord = { handle: real.handle, info };
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array([1]), name, false, ["deriveBits"])), dom("OperationError"));
      await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array([1]), name, false, [])), dom("OperationError"));
    }
    f.provider.importRecord = real;
    await assert.rejects(f.settle(f.subtle.importKey("raw", new Uint8Array(), name, false, ["deriveBits"])), dom("OperationError"));
    f.provider.importRecord = undefined;
    const empty = await f.settle(f.subtle.importKey("raw", new Uint8Array(), name, false, ["deriveBits"]));
    assert.deepEqual(f.provider.exportKey(getCryptoKeySlots(empty).handle, "raw"), new Uint8Array());
  });

  test(name + " borrows input view bounds synchronously and owns imported material", async () => {
    const f = fixture();
    const storage = new Uint8Array([99, 1, 2, 3, 88]);
    const pending = f.subtle.importKey("raw", new DataView(storage.buffer, 1, 3), name, false, ["deriveBits"]);
    assert.equal(f.provider.imports, 1);
    const input = f.provider.importInput;
    assert.ok(input?.format === "raw");
    assert.equal(input.bytes.buffer, storage.buffer);
    assert.equal(input.bytes.byteOffset, 1);
    assert.equal(input.bytes.byteLength, 3);
    storage.fill(0);
    const key = await f.settle(pending);
    assert.deepEqual(f.provider.exportKey(getCryptoKeySlots(key).handle, "raw"), new Uint8Array([1, 2, 3]));
  });

  test(name + " isolates source usages and mutable cached dictionaries from private slots", async () => {
    const f = fixture();
    const usages: KeyUsage[] = ["deriveBits", "deriveKey"];
    const algorithm = { name };
    const pending = f.subtle.importKey("raw", new Uint8Array([1]), algorithm, false, usages);
    usages.length = 0;
    algorithm.name = name === "HKDF" ? "PBKDF2" : "HKDF";
    const key = await f.settle(pending);
    const sibling = await f.settle(f.subtle.importKey("raw", new Uint8Array([1]), name, false, ["deriveBits"]));
    assert.deepEqual(key.algorithm, { name });
    assert.deepEqual(key.usages, ["deriveKey", "deriveBits"]);
    assert.equal(key.algorithm, key.algorithm);
    assert.equal(key.usages, key.usages);
    assert.notEqual(key.algorithm, sibling.algorithm);
    const publicAlgorithm = key.algorithm as { name: string };
    publicAlgorithm.name = "HMAC";
    key.usages.length = 0;
    const slots = getCryptoKeySlots(key);
    assert.equal(slots.algorithm.name, name);
    assert.deepEqual(slots.usages, ["deriveKey", "deriveBits"]);
    assert.deepEqual(sibling.algorithm, { name });
    assert.deepEqual(sibling.usages, ["deriveBits"]);
  });

  test(name + " import performs native work before return and schedules success and errors", async () => {
    const f = fixture();
    const pending = f.subtle.importKey("raw", new Uint8Array(), name, false, ["deriveBits"]);
    assert.equal(f.provider.imports, 1);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    const key = await f.settle(pending);
    assert.equal(key.type, "secret");
    assert.equal(settled, true);
    f.provider.importFailure = { failure: "operation" };
    const failed = f.subtle.importKey("raw", new Uint8Array(), name, false, ["deriveBits"]);
    assert.equal(f.provider.imports, 2);
    let rejected = false;
    void failed.catch(() => { rejected = true; });
    const rejection = assert.rejects(failed, dom("OperationError"));
    await Promise.resolve();
    assert.equal(rejected, false);
    f.scheduler.runPending();
    await rejection;
    assert.equal(rejected, true);
    const invalid = f.subtle.importKey("raw", new Uint8Array(), name, true, ["deriveBits"]);
    assert.equal(f.provider.imports, 2);
    assert.equal(f.scheduler.hasPending, true);
    await assert.rejects(f.settle(invalid), dom("SyntaxError"));
  });
}

test("both KDF get-key-length operations return null", () => {
  assert.equal(getKdfKeyLength(), null);
});
