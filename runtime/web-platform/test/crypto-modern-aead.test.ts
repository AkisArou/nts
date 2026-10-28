// Original specification controls for Modern Algorithms §§10–11.
// https://wicg.github.io/webcrypto-modern-algos/#aes-ocb
// https://wicg.github.io/webcrypto-modern-algos/#chacha20-poly1305
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type { CryptoCipherParameters, CryptoCiphertext, CryptoFailure, CryptoKeyHandle } from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  encryptCalls: number = 0;
  decryptCalls: number = 0;
  parameters: CryptoCipherParameters | undefined;
  input: Uint8Array | undefined;
  failure: CryptoFailure | undefined;
  result: CryptoCiphertext | undefined;

  override encrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoCiphertext | CryptoFailure {
    this.encryptCalls++;
    this.parameters = parameters;
    this.input = data;
    return this.failure ?? this.result ?? super.encrypt(parameters, key, data);
  }

  override decrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: CryptoCiphertext): Uint8Array | CryptoFailure {
    this.decryptCalls++;
    this.parameters = parameters;
    this.input = data.bytes;
    return this.failure ?? super.decrypt(parameters, key, data);
  }
}

function fixture() {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const random = { calls: 0, fill(bytes: Uint8Array): void { this.calls++; bytes.fill(0x42); } };
  const crypto = createCrypto(random, provider, scheduler);
  return { provider, scheduler, random, subtle: crypto.subtle };
}

type Fixture = ReturnType<typeof fixture>;
type AeadName = "AES-OCB" | "ChaCha20-Poly1305";

function complete<T>(f: Fixture, promise: Promise<T>): Promise<T> {
  f.scheduler.runPending();
  return promise;
}

function errorNamed(name: string): (error: unknown) => boolean {
  return (error) => error instanceof DOMException && error.name === name;
}

function octets(hex: string): Uint8Array<ArrayBuffer> { return new Uint8Array(Buffer.from(hex, "hex")); }

function importAead(f: Fixture, name: AeadName, material = new Uint8Array(name === "AES-OCB" ? 16 : 32),
  usages: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"]): Promise<CryptoKey> {
  return complete(f, f.subtle.importKey("raw-secret", material, name, true, usages));
}

// RFC 7253 Appendix A: empty plaintext/AAD, nonzero nonce, complete 128-bit tag.
test("AES-OCB matches RFC 7253 Appendix A and exposes ciphertext followed by its tag", async () => {
  const f = fixture();
  const key = await importAead(f, "AES-OCB", octets("000102030405060708090a0b0c0d0e0f"));
  const params = { name: "AES-OCB", iv: octets("bbaa99887766554433221100") };
  const ciphertext = await complete(f, f.subtle.encrypt(params, key, new Uint8Array()));
  assert.equal(Buffer.from(ciphertext).toString("hex"), "785407bfffc8ad9edcc5520ac9111ee6");
  assert.equal((await complete(f, f.subtle.decrypt(params, key, ciphertext))).byteLength, 0);
  assert.equal(f.provider.encryptCalls, 1);
  assert.equal(f.provider.decryptCalls, 1);
});

// RFC 8439 §2.8.2. Known answer independent of this package's round-trip path.
test("ChaCha20-Poly1305 matches RFC 8439 section 2.8.2", async () => {
  const f = fixture();
  const key = await importAead(f, "ChaCha20-Poly1305", octets(
    "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f"));
  const plaintext = new Uint8Array(Buffer.from(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."));
  const params = { name: "ChaCha20-Poly1305", iv: octets("070000004041424344454647"),
    additionalData: octets("50515253c0c1c2c3c4c5c6c7") };
  const expected = "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6" +
    "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36" +
    "92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3" +
    "ff4def08e4b7a9de576d26586cec64b6116" + "1ae10b594f09e26a7e902ecbd0600691";
  const ciphertext = await complete(f, f.subtle.encrypt(params, key, plaintext));
  assert.equal(Buffer.from(ciphertext).toString("hex"), expected);
  assert.deepEqual(new Uint8Array(await complete(f, f.subtle.decrypt(params, key, octets(expected)))), plaintext);
});

for (const name of ["AES-OCB", "ChaCha20-Poly1305"] as const) {
  test(`${name} generates normalized secret-key metadata and all permitted usages`, async () => {
    const f = fixture();
    const params = name === "AES-OCB" ? { name, length: 192 } : { name, get length(): never { throw new Error("Unused member"); } };
    const key = await complete(f, f.subtle.generateKey(params, true,
      ["unwrapKey", "encrypt", "decrypt", "wrapKey", "encrypt"])) as CryptoKey;
    assert.equal(key.type, "secret");
    assert.equal(key.extractable, true);
    assert.deepEqual(key.algorithm, name === "AES-OCB" ? { name, length: 192 } : { name });
    assert.deepEqual(key.usages, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
    assert.deepEqual(new Uint8Array(await complete(f, f.subtle.exportKey("raw-secret", key)) as ArrayBuffer),
      new Uint8Array(name === "AES-OCB" ? 24 : 32).fill(0x42));
    assert.equal(f.random.calls, 1);
  });

  test(`${name} validates generation usages before length and rejects empty usages after generation`, async () => {
    const f = fixture();
    const params = { name, length: 129 };
    await assert.rejects(complete(f, f.subtle.generateKey(params, true, ["sign"])), errorNamed("SyntaxError"));
    assert.equal(f.random.calls, 0);
    await assert.rejects(complete(f, f.subtle.generateKey({ name, length: 128 }, true, [])), errorNamed("SyntaxError"));
    assert.equal(f.random.calls, 1);
  });

  test(`${name} raw-secret import/export preserves bytes without aliasing its input or exports`, async () => {
    const f = fixture();
    const material = new Uint8Array(name === "AES-OCB" ? 16 : 32).fill(0xa5);
    const key = await importAead(f, name, material);
    material.fill(0);
    const first = new Uint8Array(await complete(f, f.subtle.exportKey("raw-secret", key)) as ArrayBuffer);
    assert.ok(first.every((byte) => byte === 0xa5));
    first.fill(1);
    const second = new Uint8Array(await complete(f, f.subtle.exportKey("raw-secret", key)) as ArrayBuffer);
    assert.ok(second.every((byte) => byte === 0xa5));
  });

  test(`${name} permits raw-secret and JWK but rejects legacy raw and asymmetric formats`, async () => {
    const f = fixture();
    const key = await importAead(f, name);
    const bytes = new Uint8Array(name === "AES-OCB" ? 16 : 32);
    for (const format of ["raw", "spki", "pkcs8"]) {
      await assert.rejects(complete(f, f.subtle.importKey(format, bytes, name, true, ["encrypt"])), errorNamed("NotSupportedError"));
      await assert.rejects(complete(f, f.subtle.exportKey(format, key)), errorNamed("NotSupportedError"));
    }
    const opaque = await complete(f, f.subtle.importKey("raw-secret", bytes, name, false, ["encrypt"]));
    await assert.rejects(complete(f, f.subtle.exportKey("raw", opaque)), errorNamed("InvalidAccessError"));
  });

  test(`${name} checks JWK algorithm, use, key_ops and ext`, async () => {
    const f = fixture();
    const key = await importAead(f, name);
    const jwk = await complete(f, f.subtle.exportKey("jwk", key));
    assert.ok(!(jwk instanceof ArrayBuffer));
    assert.equal(jwk.kty, "oct");
    assert.equal(jwk.alg, name === "AES-OCB" ? "A128OCB" : "C20P");
    const imported = await complete(f, f.subtle.importKey("jwk", jwk, name, true, ["encrypt"]));
    assert.deepEqual(imported.algorithm, key.algorithm);
    for (const change of [{ kty: "RSA" }, { k: undefined }, { alg: "A256GCM" }, { use: "sig" },
      { key_ops: ["decrypt"] }, { key_ops: ["encrypt", "encrypt"] }, { ext: false }]) {
      await assert.rejects(complete(f, f.subtle.importKey("jwk", { ...jwk, ...change }, name, true, ["encrypt"])), errorNamed("DataError"));
    }
  });

  test(`${name} enforces key width for raw-secret and JWK before native import`, async () => {
    const f = fixture();
    const permitted = name === "AES-OCB" ? [16, 24, 32] : [32];
    for (const length of [0, 1, 15, 16, 17, 23, 24, 25, 31, 32, 33]) {
      const bytes = new Uint8Array(length);
      for (const format of ["raw-secret", "jwk"] as const) {
        const data = format === "jwk" ? { kty: "oct", k: Buffer.from(bytes).toString("base64url") } : bytes;
        const promise = complete(f, f.subtle.importKey(format, data, name, true, ["encrypt"]));
        if (permitted.includes(length)) await promise;
        else await assert.rejects(promise, errorNamed("DataError"));
      }
    }
  });

  test(`${name} validates IV and tag lengths before entering native encryption or decryption`, async () => {
    const f = fixture();
    const key = await importAead(f, name);
    const badIv = name === "AES-OCB" ? [16, 17, 32] : [0, 1, 11, 13, 15, 16];
    for (const length of badIv) {
      for (const method of ["encrypt", "decrypt"] as const) {
        await assert.rejects(complete(f, f.subtle[method]({ name, iv: new Uint8Array(length) }, key, new Uint8Array(32))), errorNamed("OperationError"));
      }
    }
    for (const tagLength of [0, 1, 32, 63, 65, 95, 97, 104, 120, 127, 129, 255]) {
      for (const method of ["encrypt", "decrypt"] as const) {
        await assert.rejects(complete(f, f.subtle[method]({ name, iv: new Uint8Array(12), tagLength }, key, new Uint8Array(32))), errorNamed("OperationError"));
      }
    }
    assert.equal(f.provider.encryptCalls, 0);
    assert.equal(f.provider.decryptCalls, 0);
  });

  test(`${name} defaults to a 128-bit tag and rejects truncated ciphertext before native use`, async () => {
    const f = fixture();
    const key = await importAead(f, name);
    for (const tagLength of name === "AES-OCB" ? [undefined, 64, 96, 128] : [undefined, 128]) {
      const params = { name, iv: new Uint8Array(12), tagLength };
      const ciphertext = await complete(f, f.subtle.encrypt(params, key, new Uint8Array()));
      assert.equal(ciphertext.byteLength, (tagLength ?? 128) / 8);
      assert.equal((await complete(f, f.subtle.decrypt(params, key, ciphertext))).byteLength, 0);
      const previous = f.provider.decryptCalls;
      await assert.rejects(complete(f, f.subtle.decrypt(params, key, ciphertext.slice(1))), errorNamed("OperationError"));
      assert.equal(f.provider.decryptCalls, previous);
    }
  });

  test(`${name} authenticates plaintext, IV, AAD and every authentication-tag octet`, async () => {
    const f = fixture();
    const key = await importAead(f, name);
    const params = { name, iv: new Uint8Array(12), additionalData: new Uint8Array([1, 2, 3]) };
    const ciphertext = new Uint8Array(await complete(f, f.subtle.encrypt(params, key, new Uint8Array(17).fill(8))));
    for (let index = 0; index < ciphertext.length; index++) {
      const changed = ciphertext.slice(); changed[index]! ^= 1;
      await assert.rejects(complete(f, f.subtle.decrypt(params, key, changed)), errorNamed("OperationError"));
    }
    for (const changed of [{ ...params, iv: new Uint8Array(12).fill(1) },
      { ...params, additionalData: new Uint8Array([1, 2, 4]) }, { ...params, additionalData: undefined }]) {
      await assert.rejects(complete(f, f.subtle.decrypt(changed, key, ciphertext)), errorNamed("OperationError"));
    }
  });

  test(`${name} observes IDL dictionary order and consumes input before later mutation`, async () => {
    const f = fixture(); const key = await importAead(f, name);
    const visits: string[] = [];
    const data = new Uint8Array(17).fill(3); const iv = new Uint8Array(12); const aad = new Uint8Array([2]);
    const params = {
      get name(): string { visits.push("name"); return name.toLowerCase(); },
      get additionalData(): Uint8Array { visits.push("additionalData"); return aad; },
      get iv(): Uint8Array { visits.push("iv"); return iv; },
      get tagLength(): number { visits.push("tagLength"); return 128; },
    };
    const pending = f.subtle.encrypt(params, key, data);
    assert.deepEqual(visits, ["name", "name", "additionalData", "iv", "tagLength"]);
    assert.equal(f.provider.input, data);
    data.fill(0); iv.buffer.transfer(); aad.fill(4);
    const ciphertext = await complete(f, pending);
    assert.deepEqual(new Uint8Array(await complete(f, f.subtle.decrypt(
      { name, iv: new Uint8Array(12), additionalData: new Uint8Array([2]) }, key, ciphertext))), new Uint8Array(17).fill(3));
  });

  test(`${name} converts octet tagLength with EnforceRange and requires an ordinary BufferSource IV`, async () => {
    const f = fixture(); const key = await importAead(f, name);
    for (const tagLength of [-1, 256, NaN, Infinity, 1n]) {
      await assert.rejects(complete(f, f.subtle.encrypt({ name, iv: new Uint8Array(12), tagLength }, key, new Uint8Array())), TypeError);
    }
    for (const iv of [undefined, null, [], new SharedArrayBuffer(12)]) {
      await assert.rejects(complete(f, f.subtle.encrypt({ name, iv }, key, new Uint8Array())), TypeError);
    }
    assert.equal(f.provider.encryptCalls, 0);
  });

  test(`${name} performs both required name conversions when a getter transfers data`, async () => {
    const f = fixture(); const key = await importAead(f, name);
    for (const method of ["encrypt", "decrypt"] as const) {
      const bytes = new Uint8Array(32);
      let reads = 0;
      const params = { iv: new Uint8Array(12), get name(): string {
        reads++; bytes.buffer.transfer(); return name;
      } };
      await assert.rejects(complete(f, f.subtle[method](params, key, bytes)), TypeError);
      assert.equal(reads, 2);
    }
    assert.equal(f.provider.encryptCalls, 0);
    assert.equal(f.provider.decryptCalls, 0);
  });

  test(`${name} handles view offsets without exposing the surrounding bytes`, async () => {
    const f = fixture(); const key = await importAead(f, name);
    const all = new Uint8Array(64).fill(5);
    const params = { name, iv: new DataView(all.buffer, 3, 12), additionalData: new Uint8Array(all.buffer, 32, 7) };
    const ciphertext = await complete(f, f.subtle.encrypt(params, key, new DataView(all.buffer, 20, 9)));
    assert.equal(ciphertext.byteLength, 25);
    assert.deepEqual(new Uint8Array(await complete(f, f.subtle.decrypt(params, key, ciphertext))), new Uint8Array(9).fill(5));
  });

  test(`${name} uses encryption registration for raw-secret and JWK wrapping`, async () => {
    const f = fixture(); const wrappingKey = await importAead(f, name);
    const target = await importAead(f, name, new Uint8Array(name === "AES-OCB" ? 16 : 32).fill(9));
    const params = { name, iv: new Uint8Array(12), additionalData: new Uint8Array([7]) };
    for (const format of ["raw-secret", "jwk"]) {
      const wrapped = await complete(f, f.subtle.wrapKey(format, target, wrappingKey, params));
      const unwrapped = await complete(f, f.subtle.unwrapKey(format, wrapped, wrappingKey, params, name, true, ["decrypt"]));
      assert.deepEqual(unwrapped.algorithm, target.algorithm);
      assert.deepEqual(unwrapped.usages, ["decrypt"]);
      assert.deepEqual(await complete(f, f.subtle.exportKey("raw-secret", unwrapped)), await complete(f, f.subtle.exportKey("raw-secret", target)));
    }
  });

  test(`${name} derives target keys through its registered key-length and raw-secret import operations`, async () => {
    const f = fixture();
    const base = await complete(f, f.subtle.importKey("raw", new Uint8Array([1, 2, 3]), "HKDF", false, ["deriveKey", "deriveBits"]));
    const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new Uint8Array() };
    const target = name === "AES-OCB" ? { name, length: 192 } : { name, get length(): never { throw new Error("Unused member"); } };
    const key = await complete(f, f.subtle.deriveKey(params, base, target, true, ["encrypt"]));
    const bits = await complete(f, f.subtle.deriveBits(params, base, name === "AES-OCB" ? 192 : 256));
    assert.deepEqual(await complete(f, f.subtle.exportKey("raw-secret", key)), bits);
  });

  test(`${name} checks key identity and usage before its parameter bounds`, async () => {
    const f = fixture();
    const key = await importAead(f, name, undefined, ["decrypt"]);
    await assert.rejects(complete(f, f.subtle.encrypt({ name, iv: new Uint8Array(99) }, key, new Uint8Array())), errorNamed("InvalidAccessError"));
    const other = await importAead(f, name === "AES-OCB" ? "ChaCha20-Poly1305" : "AES-OCB");
    await assert.rejects(complete(f, f.subtle.encrypt({ name, iv: new Uint8Array(99) }, other, new Uint8Array())), errorNamed("InvalidAccessError"));
    assert.equal(f.provider.encryptCalls, 0);
  });

  test(`${name} maps native failures to scheduled OperationError without returning plaintext`, async () => {
    const f = fixture(); const key = await importAead(f, name);
    for (const failure of ["invalid-key", "operation"] as const) {
      f.provider.failure = { failure };
      for (const method of ["encrypt", "decrypt"] as const) {
        let settled = false;
        const pending = f.subtle[method]({ name, iv: new Uint8Array(12) }, key, new Uint8Array(32));
        void pending.catch(() => { settled = true; });
        await Promise.resolve(); assert.equal(settled, false);
        await assert.rejects(complete(f, pending), errorNamed("OperationError"));
      }
    }
  });
}

test("AES-OCB native test provider supports all positive IV lengths and all specified key/tag widths", async () => {
  const f = fixture();
  for (const length of [16, 24, 32]) {
    const material = new Uint8Array(length);
    const key = await importAead(f, "AES-OCB", material);
    const nativeKey = await webcrypto.subtle.importKey("raw-secret", material, "AES-OCB", false, ["encrypt"]);
    for (let ivLength = 1; ivLength <= 15; ivLength++) {
      for (const tagLength of [64, 96, 128]) {
        const params = { name: "AES-OCB", iv: new Uint8Array(ivLength), tagLength, additionalData: new Uint8Array([4]) };
        const plaintext = new Uint8Array(31).fill(2);
        const ciphertext = await complete(f, f.subtle.encrypt(params, key, plaintext));
        assert.deepEqual(ciphertext, await webcrypto.subtle.encrypt(params, nativeKey, plaintext));
        assert.deepEqual(new Uint8Array(await complete(f, f.subtle.decrypt(params, key, ciphertext))), plaintext);
      }
    }
  }
});

test("AES-OCB shared policy passes empty IV to native; Node 24.20 reports its unsupported native parameter", async () => {
  const f = fixture(); const key = await importAead(f, "AES-OCB");
  const params = { name: "AES-OCB", iv: new Uint8Array() };
  await assert.rejects(complete(f, f.subtle.encrypt(params, key, new Uint8Array())), errorNamed("OperationError"));
  assert.equal(f.provider.encryptCalls, 1);
  assert.equal(f.provider.parameters!.name, "AES-OCB");
  // A recording result proves the shared algorithm imposes only §10.4.1's >15 bound.
  f.provider.result = { bytes: new Uint8Array(), tag: new Uint8Array(16) };
  assert.equal((await complete(f, f.subtle.encrypt(params, key, new Uint8Array()))).byteLength, 16);
});

test("AEAD refuses an inconsistent native tag result", async () => {
  const f = fixture(); const key = await importAead(f, "AES-OCB");
  for (const tag of [null, new Uint8Array(15), new Uint8Array(17)]) {
    f.provider.result = { bytes: new Uint8Array(), tag };
    await assert.rejects(complete(f, f.subtle.encrypt({ name: "AES-OCB", iv: new Uint8Array(12) }, key, new Uint8Array())), errorNamed("OperationError"));
  }
});
