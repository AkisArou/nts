// Specification-derived tests, not copies of WPT.
// Web Cryptography Level 2 §§14.3.1–2, 14.3.11–12, 27–30:
// https://w3c.github.io/webcrypto/
// CBC/CTR known answers: SP 800-38A Appendix F.2/F.5.
// https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf
// Key-wrap known answers: RFC 3394 §4.1–4.3.
// https://www.rfc-editor.org/rfc/rfc3394#section-4
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";

import { DOMException } from "../src/core/errors.ts";
import { Crypto } from "../src/crypto/crypto.ts";
import type { CryptoKey, KeyUsage } from "../src/crypto/crypto-key.ts";
import type {
  CryptoCipherParameters,
  CryptoCiphertext,
  CryptoFailure,
  CryptoKeyHandle,
} from "../src/provider/crypto.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class RecordingProvider extends NodeCryptoProvider {
  encryptCalls: number = 0;
  decryptCalls: number = 0;
  encryptedInput: Uint8Array | undefined;
  decryptedInput: CryptoCiphertext | undefined;
  fail: "invalid-key" | "operation" | undefined;

  override encrypt(
    algorithm: CryptoCipherParameters,
    key: CryptoKeyHandle,
    data: Uint8Array,
  ): CryptoCiphertext | CryptoFailure {
    this.encryptCalls++;
    // Retain the borrowed reference only to observe the no-copy seam in tests.
    this.encryptedInput = data;
    if (this.fail !== undefined) return { failure: this.fail };
    return super.encrypt(algorithm, key, data);
  }

  override decrypt(
    algorithm: CryptoCipherParameters,
    key: CryptoKeyHandle,
    data: CryptoCiphertext,
  ): Uint8Array | CryptoFailure {
    this.decryptCalls++;
    this.decryptedInput = data;
    if (this.fail !== undefined) return { failure: this.fail };
    return super.decrypt(algorithm, key, data);
  }
}

interface Fixture {
  readonly crypto: Crypto;
  readonly scheduler: VirtualScheduler;
  readonly provider: RecordingProvider;
}

function fixture(): Fixture {
  const provider = new RecordingProvider();
  const scheduler = new VirtualScheduler();
  const random = { fill(bytes: Uint8Array): void { bytes.fill(0x42); } };
  return { crypto: new Crypto(random, provider, scheduler), scheduler, provider };
}

function complete<T>(f: Fixture, promise: Promise<T>): Promise<T> {
  f.scheduler.runPending();
  return promise;
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, "hex"));
}

function hex(data: ArrayBuffer): string {
  return Buffer.from(data).toString("hex");
}

function errorNamed(name: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof DOMException && error.name === name;
}

async function importAes(
  f: Fixture,
  name: string,
  data: Uint8Array = new Uint8Array(16),
  usages: readonly KeyUsage[] = name === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  return complete(f, f.crypto.subtle.importKey("raw", data, name, true, usages));
}

const plaintext = bytes(
  "6bc1bee22e409f96e93d7e117393172a"
  + "ae2d8a571e03ac9c9eb76fac45af8e51"
  + "30c81c46a35ce411e5fbc1191a0a52ef"
  + "f69f2445df4f9b17ad2b417be66c3710",
);
const iv = bytes("000102030405060708090a0b0c0d0e0f");
const counter = bytes("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
const nistVectors: readonly {
  bits: number;
  key: string;
  ctr: string;
  cbc: string;
}[] = [
  {
    bits: 128,
    key: "2b7e151628aed2a6abf7158809cf4f3c",
    ctr: "874d6191b620e3261bef6864990db6ce"
      + "9806f66b7970fdff8617187bb9fffdff"
      + "5ae4df3edbd5d35e5b4f09020db03eab"
      + "1e031dda2fbe03d1792170a0f3009cee",
    cbc: "7649abac8119b246cee98e9b12e9197d"
      + "5086cb9b507219ee95db113a917678b2"
      + "73bed6b8e3c1743b7116e69e22229516"
      + "3ff1caa1681fac09120eca307586e1a7",
  },
  {
    bits: 192,
    key: "8e73b0f7da0e6452c810f32b809079e562f8ead2522c6b7b",
    ctr: "1abc932417521ca24f2b0459fe7e6e0b"
      + "090339ec0aa6faefd5ccc2c6f4ce8e94"
      + "1e36b26bd1ebc670d1bd1d665620abf7"
      + "4f78a7f6d29809585a97daec58c6b050",
    cbc: "4f021db243bc633d7178183a9fa071e8"
      + "b4d9ada9ad7dedf4e5e738763f69145a"
      + "571b242012fb7ae07fa9baac3df102e0"
      + "08b0e27988598881d920a9e64f5615cd",
  },
  {
    bits: 256,
    key: "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4",
    ctr: "601ec313775789a5b7a7f504bbf3d228"
      + "f443e3ca4d62b59aca84e990cacaf5c5"
      + "2b0930daa23de94ce87017ba2d84988d"
      + "dfc9c58db67aada613c2dd08457941a6",
    cbc: "f58c4c04d6e5f1ba779eabfb5f7bfbd6"
      + "9cfc4e967edb808d679f777bc6702c7d"
      + "39f23369a9d9bacfa530e26304231461"
      + "b2eb05e2c39be9fcda6c19078c6a9d1b",
  },
];

for (const vector of nistVectors) {
  test(`AES-CTR ${vector.bits} encrypts and decrypts the NIST known answer`, async () => {
    const f = fixture();
    const key = await importAes(f, "AES-CTR", bytes(vector.key));
    const params = { name: "AES-CTR", counter, length: 128 };
    const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, plaintext));
    assert.equal(hex(encrypted), vector.ctr);
    const decrypted = await complete(f, f.crypto.subtle.decrypt(params, key, bytes(vector.ctr)));
    assert.deepEqual(new Uint8Array(decrypted), plaintext);
    assert.equal(f.provider.encryptCalls, 1);
    assert.equal(f.provider.decryptCalls, 1);
    assert.equal(f.provider.encryptedInput, plaintext);
  });

  test(`AES-CBC ${vector.bits} preserves the NIST blocks and adds mandatory padding`, async () => {
    const f = fixture();
    const key = await importAes(f, "AES-CBC", bytes(vector.key));
    const params = { name: "AES-CBC", iv };
    const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, plaintext));
    assert.equal(encrypted.byteLength, 80);
    assert.equal(hex(encrypted).slice(0, 128), vector.cbc);
    const decrypted = await complete(f, f.crypto.subtle.decrypt(params, key, encrypted));
    assert.deepEqual(new Uint8Array(decrypted), plaintext);
    assert.equal(decrypted.byteLength, plaintext.byteLength, "padding must not remain in the backing buffer");
    assert.equal(f.provider.encryptCalls, 1);
    assert.equal(f.provider.decryptCalls, 1);
    assert.notEqual(f.provider.encryptedInput!.buffer, plaintext.buffer);
    assert.deepEqual([...f.provider.encryptedInput!.subarray(64)], new Array<number>(16).fill(16));
  });
}

test("AES-CTR handles empty input and partial final blocks without padding", async () => {
  const f = fixture();
  const vector = nistVectors[0]!;
  const key = await importAes(f, "AES-CTR", bytes(vector.key));
  const params = { name: "AES-CTR", counter, length: 128 };
  for (const length of [0, 1, 15, 16, 17, 31, 33, 63]) {
    const input = plaintext.subarray(0, length);
    const result = await complete(f, f.crypto.subtle.encrypt(params, key, input));
    assert.equal(result.byteLength, length);
    assert.equal(hex(result), vector.ctr.slice(0, length * 2));
    const decoded = await complete(f, f.crypto.subtle.decrypt(params, key, result));
    assert.deepEqual(new Uint8Array(decoded), input);
  }
});

test("AES-CTR rejects invalid counter sizes and counter-bit lengths before the primitive", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CTR");
  for (const size of [0, 1, 15, 17, 32]) {
    for (const method of ["encrypt", "decrypt"] as const) {
      const pending = f.crypto.subtle[method]({ name: "AES-CTR", counter: new Uint8Array(size), length: 64 }, key, plaintext);
      await assert.rejects(complete(f, pending), errorNamed("OperationError"));
    }
  }
  for (const length of [0, 129, 255]) {
    for (const method of ["encrypt", "decrypt"] as const) {
      const pending = f.crypto.subtle[method]({ name: "AES-CTR", counter, length }, key, new Uint8Array());
      await assert.rejects(complete(f, pending), errorNamed("OperationError"));
    }
  }
  assert.equal(f.provider.encryptCalls, 0);
  assert.equal(f.provider.decryptCalls, 0);
});

test("AES-CTR rejects a repeated counter, including a partial block past its period", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CTR");
  for (const bits of [1, 2, 8, 9]) {
    const last = new Uint8Array(16).fill(255);
    const params = { name: "AES-CTR", counter: last, length: bits };
    const boundary = new Uint8Array(16 * 2 ** bits);
    const result = await complete(f, f.crypto.subtle.encrypt(params, key, boundary));
    assert.equal(result.byteLength, boundary.byteLength);
    assert.deepEqual(new Uint8Array(await complete(f, f.crypto.subtle.decrypt(params, key, result))), boundary);
    const calls = [f.provider.encryptCalls, f.provider.decryptCalls];
    for (const method of ["encrypt", "decrypt"] as const) {
      await assert.rejects(
        complete(f, f.crypto.subtle[method](params, key, new Uint8Array(boundary.byteLength + 1))),
        errorNamed("OperationError"),
      );
    }
    assert.deepEqual([f.provider.encryptCalls, f.provider.decryptCalls], calls);
  }
});

test("AES-CTR low-bit wrap keeps the nonce unchanged and reaches one primitive per operation", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CTR");
  const params = { name: "AES-CTR", counter: new Uint8Array(16).fill(255), length: 1 };
  const input = new Uint8Array(32);
  const result = await complete(f, f.crypto.subtle.encrypt(params, key, input));
  // Independent expected native blocks: counter ff..ff, then ff..fe.
  const firstCounter = new Uint8Array(16).fill(255);
  const secondCounter = firstCounter.slice();
  secondCounter[15] = 254;
  const first = createCipheriv("aes-128-ctr", new Uint8Array(16), firstCounter).update(new Uint8Array(16));
  const second = createCipheriv("aes-128-ctr", new Uint8Array(16), secondCounter).update(new Uint8Array(16));
  assert.deepEqual(Buffer.from(result), Buffer.concat([first, second]));
  assert.equal(f.provider.encryptCalls, 1);
});

test("AES-CTR counter reuse checks ignore Math.ceil changes from algorithm getters", { skip: "rule 405266cf7 (call methods plainly): nts programs cannot redefine intrinsic methods, constructors, or prototypes" }, async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CTR");
  for (const method of ["encrypt", "decrypt"] as const) {
    const originalCeil = Math.ceil;
    let pending: Promise<ArrayBuffer>;
    try {
      pending = f.crypto.subtle[method]({
        name: "AES-CTR",
        counter,
        get length(): number {
          Math.ceil = (): number => 0;
          return 1;
        },
      }, key, new Uint8Array(33));
    } finally {
      Math.ceil = originalCeil;
    }
    await assert.rejects(complete(f, pending), errorNamed("OperationError"));
  }
  assert.equal(f.provider.encryptCalls, 0);
  assert.equal(f.provider.decryptCalls, 0);
});

test("AES-CBC adds and removes all sixteen permitted padding lengths", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CBC");
  const params = { name: "AES-CBC", iv };
  for (let length = 0; length <= 32; length++) {
    const input = new Uint8Array(length).fill(0x42);
    const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, input));
    const padding = 16 - length % 16;
    assert.equal(encrypted.byteLength, length + padding);
    assert.deepEqual([...f.provider.encryptedInput!.subarray(length)], new Array<number>(padding).fill(padding));
    assert.deepEqual(new Uint8Array(await complete(f, f.crypto.subtle.decrypt(params, key, encrypted))), input);
  }
});

test("AES-CBC rejects wrong IV and ciphertext lengths before the primitive", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CBC");
  for (const length of [0, 1, 15, 17, 32]) {
    for (const method of ["encrypt", "decrypt"] as const) {
      await assert.rejects(
        complete(f, f.crypto.subtle[method]({ name: "AES-CBC", iv: new Uint8Array(length) }, key, plaintext)),
        errorNamed("OperationError"),
      );
    }
  }
  for (const length of [0, 1, 15, 17, 31, 33]) {
    await assert.rejects(
      complete(f, f.crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, new Uint8Array(length))),
      errorNamed("OperationError"),
    );
  }
  assert.equal(f.provider.encryptCalls, 0);
  assert.equal(f.provider.decryptCalls, 0);
});

function rawCbc(padded: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-128-cbc", new Uint8Array(16), iv);
  cipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([cipher.update(padded), cipher.final()]));
}

test("AES-CBC rejects every invalid final padding value", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CBC");
  const params = { name: "AES-CBC", iv };
  for (let padding = 0; padding < 256; padding++) {
    const pending = complete(f, f.crypto.subtle.decrypt(params, key, rawCbc(new Uint8Array(16).fill(padding))));
    if (padding >= 1 && padding <= 16) {
      assert.equal((await pending).byteLength, 16 - padding);
    } else {
      await assert.rejects(pending, errorNamed("OperationError"), `padding ${padding}`);
    }
  }
});

test("AES-CBC checks every claimed padding octet, not only the final one", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CBC");
  for (let padding = 2; padding <= 16; padding++) {
    for (let position = 1; position < padding; position++) {
      const padded = new Uint8Array(16).fill(padding);
      padded[15 - position] = padding ^ 1;
      await assert.rejects(
        complete(f, f.crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, rawCbc(padded))),
        errorNamed("OperationError"),
      );
    }
  }
});

// GCM submission Appendix B, cases 2/8/14 (zero keys, zero 96-bit IV,
// zero 128-bit plaintext). These fixed bytes avoid a round-trip-only oracle.
// https://csrc.nist.gov/groups/ST/toolkit/BCM/documents/proposedmodes/gcm/gcm-revised-spec.pdf
const gcmVectors = [
  { bits: 128, result: "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf" },
  { bits: 192, result: "98e7247c07f0fe411c267e4384b0f6002ff58d80033927ab8ef4d4587514f0fb" },
  { bits: 256, result: "cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919" },
];

for (const vector of gcmVectors) {
  test(`AES-GCM ${vector.bits} returns ciphertext followed by its authentication tag`, async () => {
    const f = fixture();
    const key = await importAes(f, "AES-GCM", new Uint8Array(vector.bits / 8));
    const params = { name: "AES-GCM", iv: new Uint8Array(12) };
    const result = await complete(f, f.crypto.subtle.encrypt(params, key, new Uint8Array(16)));
    assert.equal(hex(result), vector.result);
    assert.deepEqual(new Uint8Array(await complete(f, f.crypto.subtle.decrypt(params, key, bytes(vector.result)))), new Uint8Array(16));
    assert.equal(f.provider.encryptCalls, 1);
    assert.equal(f.provider.decryptCalls, 1);
  });
}

test("AES-GCM accepts all specified tag lengths and uses 128 bits by default", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  for (const tagLength of [undefined, 32, 64, 96, 104, 112, 120, 128]) {
    const params = { name: "AES-GCM", iv: new Uint8Array(12), tagLength };
    const result = await complete(f, f.crypto.subtle.encrypt(params, key, new Uint8Array(16)));
    assert.equal(hex(result), gcmVectors[0]!.result.slice(0, 32 + (tagLength ?? 128) / 4));
    assert.deepEqual(new Uint8Array(await complete(f, f.crypto.subtle.decrypt(params, key, result))), new Uint8Array(16));
  }
});

test("AES-GCM rejects unsupported tag lengths before invoking the primitive", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  for (const tagLength of [0, 1, 31, 33, 63, 65, 95, 97, 103, 105, 111, 113, 119, 121, 127, 129, 255]) {
    for (const method of ["encrypt", "decrypt"] as const) {
      const params = { name: "AES-GCM", iv: new Uint8Array(12), tagLength };
      await assert.rejects(complete(f, f.crypto.subtle[method](params, key, new Uint8Array(32))), errorNamed("OperationError"));
    }
  }
  assert.equal(f.provider.encryptCalls, 0);
  assert.equal(f.provider.decryptCalls, 0);
});

test("AES-GCM accepts empty plaintext and requires the complete tag during decryption", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  for (const tagLength of [32, 64, 96, 104, 112, 120, 128]) {
    const params = { name: "AES-GCM", iv: new Uint8Array(12), tagLength };
    const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, new Uint8Array()));
    assert.equal(encrypted.byteLength, tagLength / 8);
    assert.equal((await complete(f, f.crypto.subtle.decrypt(params, key, encrypted))).byteLength, 0);
    const calls = f.provider.decryptCalls;
    await assert.rejects(
      complete(f, f.crypto.subtle.decrypt(params, key, new Uint8Array(tagLength / 8 - 1))),
      errorNamed("OperationError"),
    );
    assert.equal(f.provider.decryptCalls, calls);
  }
});

test("AES-GCM authenticates ciphertext, tag, IV and additional data", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  const params = { name: "AES-GCM", iv: new Uint8Array(12), additionalData: bytes("01020304") };
  const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, plaintext));
  for (const position of [0, plaintext.length - 1, plaintext.length, encrypted.byteLength - 1]) {
    const changed = new Uint8Array(encrypted.slice(0));
    changed[position] = changed[position]! ^ 1;
    await assert.rejects(complete(f, f.crypto.subtle.decrypt(params, key, changed)), errorNamed("OperationError"));
  }
  for (const changed of [
    { ...params, iv: new Uint8Array(12).fill(1) },
    { ...params, additionalData: bytes("01020305") },
    { ...params, additionalData: undefined },
  ]) {
    await assert.rejects(complete(f, f.crypto.subtle.decrypt(changed, key, encrypted)), errorNamed("OperationError"));
  }
});

test("AES-GCM accepts non-96-bit IVs through the same primitive seam", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  for (const ivLength of [1, 8, 16, 32]) {
    const params = { name: "AES-GCM", iv: new Uint8Array(ivLength), additionalData: new Uint8Array() };
    const encrypted = await complete(f, f.crypto.subtle.encrypt(params, key, plaintext));
    assert.deepEqual(new Uint8Array(await complete(f, f.crypto.subtle.decrypt(params, key, encrypted))), plaintext);
  }
});

const keyWrapVectors = [
  { bits: 128, key: "000102030405060708090a0b0c0d0e0f", wrapped: "1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5" },
  { bits: 192, key: "000102030405060708090a0b0c0d0e0f1011121314151617", wrapped: "96778b25ae6ca435f92b5b97c050aed2468ab8a17ad84e5d" },
  { bits: 256, key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", wrapped: "64e8c3f9ce0f5ba263e9777905818a2a93c8191e7d6e8ae7" },
];

for (const vector of keyWrapVectors) {
  test(`AES-KW ${vector.bits} matches the RFC 3394 wrap and unwrap vector`, async () => {
    const f = fixture();
    const wrappingKey = await importAes(f, "AES-KW", bytes(vector.key));
    const keyData = bytes("00112233445566778899aabbccddeeff");
    const target = await importAes(f, "AES-CBC", keyData);
    const wrapped = await complete(f, f.crypto.subtle.wrapKey("raw", target, wrappingKey, "AES-KW"));
    assert.equal(hex(wrapped), vector.wrapped);
    const unwrapped = await complete(f, f.crypto.subtle.unwrapKey(
      "raw", bytes(vector.wrapped), wrappingKey, "AES-KW", "AES-CBC", true, ["encrypt", "decrypt"],
    ));
    const exported = await complete(f, f.crypto.subtle.exportKey("raw", unwrapped));
    assert.deepEqual(new Uint8Array(exported as ArrayBuffer), keyData);
    assert.equal(f.provider.encryptCalls, 1);
    assert.equal(f.provider.decryptCalls, 1);
  });
}

test("AES-KW unwrap rejects invalid sizes and native integrity failure", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-KW");
  for (const length of [0, 1, 8, 16, 17, 23, 25, 31]) {
    await assert.rejects(
      complete(f, f.crypto.subtle.unwrapKey("raw", new Uint8Array(length), key, "AES-KW", "AES-CBC", true, ["encrypt"])),
      errorNamed("OperationError"),
    );
  }
  assert.equal(f.provider.decryptCalls, 0);
  const target = await importAes(f, "AES-CBC");
  const wrapped = new Uint8Array(await complete(f, f.crypto.subtle.wrapKey("raw", target, key, "AES-KW")));
  for (const position of [0, 8, wrapped.length - 1]) {
    const changed = wrapped.slice();
    changed[position] = changed[position]! ^ 1;
    await assert.rejects(
      complete(f, f.crypto.subtle.unwrapKey("raw", changed, key, "AES-KW", "AES-CBC", true, ["encrypt"])),
      errorNamed("OperationError"),
    );
  }
});

test("AES-KW wraps only at least two complete 64-bit blocks", async () => {
  const f = fixture();
  const wrappingKey = await importAes(f, "AES-KW");
  for (const length of [1, 7, 8, 9, 15, 17, 23, 25]) {
    const target = await complete(f, f.crypto.subtle.importKey(
      "raw", new Uint8Array(length), { name: "HMAC", hash: "SHA-256" }, true, ["sign"],
    ));
    await assert.rejects(complete(f, f.crypto.subtle.wrapKey("raw", target, wrappingKey, "AES-KW")), errorNamed("OperationError"));
  }
  assert.equal(f.provider.encryptCalls, 0);
  for (const length of [16, 24, 32, 40]) {
    const target = await complete(f, f.crypto.subtle.importKey(
      "raw", new Uint8Array(length), { name: "HMAC", hash: "SHA-256" }, true, ["sign"],
    ));
    assert.equal((await complete(f, f.crypto.subtle.wrapKey("raw", target, wrappingKey, "AES-KW"))).byteLength, length + 8);
  }
});

test("AES-KW is registered for wrapping, not encrypt or decrypt", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-KW");
  for (const method of ["encrypt", "decrypt"] as const) {
    await assert.rejects(complete(f, f.crypto.subtle[method]("AES-KW", key, plaintext)), errorNamed("NotSupportedError"));
  }
  assert.equal(f.provider.encryptCalls, 0);
  assert.equal(f.provider.decryptCalls, 0);
});

for (const name of ["AES-CTR", "AES-CBC", "AES-GCM"] as const) {
  test(`${name} supports wrapKey/unwrapKey through its encryption registration`, async () => {
    const f = fixture();
    const wrappingKey = await importAes(f, name, new Uint8Array(16), ["wrapKey", "unwrapKey"]);
    const params = name === "AES-CTR"
      ? { name, counter, length: 64 }
      : { name, iv: name === "AES-GCM" ? new Uint8Array(12) : iv };
    const target = await importAes(f, "AES-CBC", bytes("00112233445566778899aabbccddeeff"));
    for (const format of ["raw", "jwk"] as const) {
      const wrapped = await complete(f, f.crypto.subtle.wrapKey(format, target, wrappingKey, params));
      const unwrapped = await complete(f, f.crypto.subtle.unwrapKey(
        format, wrapped, wrappingKey, params, "AES-CBC", true, ["decrypt"],
      ));
      const exported = await complete(f, f.crypto.subtle.exportKey("raw", unwrapped));
      assert.equal(hex(exported as ArrayBuffer), "00112233445566778899aabbccddeeff");
      assert.deepEqual(unwrapped.usages, ["decrypt"]);
    }
  });
}

test("AES operation errors settle through the scheduler and never expose provider failures", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-CTR");
  for (const failure of ["invalid-key", "operation"] as const) {
    f.provider.fail = failure;
    for (const method of ["encrypt", "decrypt"] as const) {
      let settled = false;
      const pending = f.crypto.subtle[method]({ name: "AES-CTR", counter, length: 128 }, key, plaintext);
      void pending.catch(() => { settled = true; });
      await Promise.resolve();
      assert.equal(settled, false);
      await assert.rejects(complete(f, pending), errorNamed("OperationError"));
    }
  }
});

test("AES key algorithm and usages are checked before algorithm-specific input lengths", async () => {
  const f = fixture();
  const gcm = await importAes(f, "AES-GCM");
  const decryptOnly = await importAes(f, "AES-CBC", new Uint8Array(16), ["decrypt"]);
  const invalidCbc = { name: "AES-CBC", iv: new Uint8Array(15) };
  await assert.rejects(complete(f, f.crypto.subtle.encrypt(invalidCbc, gcm, plaintext)), errorNamed("InvalidAccessError"));
  await assert.rejects(complete(f, f.crypto.subtle.encrypt(invalidCbc, decryptOnly, plaintext)), errorNamed("InvalidAccessError"));
  assert.equal(f.provider.encryptCalls, 0);
});

test("AES consumes data and parameters before mutation or transfer after the call", async () => {
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  const input = new Uint8Array(16);
  const nonce = new Uint8Array(12);
  const pending = f.crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, input);
  input.fill(0x42);
  nonce.buffer.transfer();
  assert.equal(hex(await complete(f, pending)), gcmVectors[0]!.result);
});

test("AES handles BufferSource offsets without encrypting surrounding bytes", async () => {
  const f = fixture();
  const vector = nistVectors[0]!;
  const key = await importAes(f, "AES-CTR", bytes(vector.key));
  const all = new Uint8Array(plaintext.length + 16).fill(255);
  all.set(plaintext, 8);
  const allCounters = new Uint8Array(24).fill(255);
  allCounters.set(counter, 4);
  const params = { name: "AES-CTR", counter: new DataView(allCounters.buffer, 4, 16), length: 128 };
  const result = await complete(f, f.crypto.subtle.encrypt(params, key, new DataView(all.buffer, 8, plaintext.length)));
  assert.equal(hex(result), vector.ctr);
  assert.deepEqual([...all.subarray(0, 8)], new Array<number>(8).fill(255));
  assert.deepEqual([...all.subarray(all.length - 8)], new Array<number>(8).fill(255));
});

test("AES ignores borrowed Uint8Array accessors and species in padding, counter wrap and tag splitting", { skip: "redefining an intrinsic accessor is something nts programs cannot do" }, async () => {
  class TrickyBytes extends Uint8Array {
    override get buffer(): ArrayBuffer { throw new Error("buffer getter must not run"); }
    override get byteOffset(): number { throw new Error("offset getter must not run"); }
    override get byteLength(): number { throw new Error("length getter must not run"); }
    override subarray(_start?: number, _end?: number): Uint8Array<ArrayBuffer> { throw new Error("subarray must not run"); }
    static get [Symbol.species](): Uint8ArrayConstructor { throw new Error("species must not run"); }
  }
  const f = fixture();
  const key = await importAes(f, "AES-GCM");
  const input = new TrickyBytes(bytes(gcmVectors[0]!.result));
  const result = await complete(f, f.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, input));
  assert.deepEqual(new Uint8Array(result), new Uint8Array(16));

  const cbcKey = await importAes(f, "AES-CBC");
  const cbcParams = { name: "AES-CBC", iv: new TrickyBytes(iv) };
  const cbcCiphertext = await complete(f, f.crypto.subtle.encrypt(cbcParams, cbcKey, new TrickyBytes(15)));
  const cbcPlaintext = await complete(f, f.crypto.subtle.decrypt(cbcParams, cbcKey, new TrickyBytes(cbcCiphertext)));
  assert.deepEqual(new Uint8Array(cbcPlaintext), new Uint8Array(15));

  const ctrKey = await importAes(f, "AES-CTR");
  const ctrParams = { name: "AES-CTR", counter: new TrickyBytes(16).fill(255), length: 1 };
  const ctrInput = new TrickyBytes(32);
  const ctrCiphertext = await complete(f, f.crypto.subtle.encrypt(ctrParams, ctrKey, ctrInput));
  assert.equal(f.provider.encryptedInput, ctrInput);
  const ctrPlaintext = await complete(f, f.crypto.subtle.decrypt(ctrParams, ctrKey, new TrickyBytes(ctrCiphertext)));
  assert.deepEqual(new Uint8Array(ctrPlaintext), new Uint8Array(32));
});
