// Controls for the Node primitive fixture's ownership and native-operation seam.
// These do not exercise or substitute for this package's Web Crypto policy tests.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  CryptoAesGcmParameters,
  CryptoFailure,
  CryptoKeyHandle,
  CryptoKeyRecord,
} from "../src/provider/crypto.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

function bytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function secret(provider: NodeCryptoProvider, key: Uint8Array): CryptoKeyRecord {
  return success(provider.importKey({ format: "raw", family: "secret", bytes: key }));
}

function assertOwned(value: Uint8Array): void {
  assert.ok(value.buffer instanceof ArrayBuffer);
  assert.equal(value.byteOffset, 0);
  assert.equal(value.byteLength, value.buffer.byteLength);
}

test("native secret handles own imported material and exports never alias it", () => {
  const provider = new NodeCryptoProvider();
  const input = bytes("000102030405060708090a0b0c0d0e0f");
  const imported = secret(provider, input);
  assert.deepEqual(imported.info, { family: "secret", type: "secret", length: 128 });
  assert.deepEqual(Object.keys(imported.handle), []);
  input.fill(255);
  const first = success(provider.exportKey(imported.handle, "raw"));
  const second = success(provider.exportKey(imported.handle, "raw"));
  assertOwned(first);
  assertOwned(second);
  assert.notEqual(first.buffer, second.buffer);
  assert.equal(hex(first), "000102030405060708090a0b0c0d0e0f");
  first.fill(0);
  assert.equal(hex(second), "000102030405060708090a0b0c0d0e0f");
  const components = success(provider.exportComponents(imported.handle));
  assert.equal(components.family, "secret");
  assert.ok(components.family === "secret");
  assertOwned(components.k);
  components.k.fill(0);
  assert.equal(hex(success(provider.exportKey(imported.handle, "raw"))), hex(second));
});

test("native secret component imports copy bytes and compatible providers share handles", () => {
  const first = new NodeCryptoProvider();
  const second = new NodeCryptoProvider();
  const k = new Uint8Array([1, 2, 3, 4]);
  const imported = success(first.importKey({ format: "components", components: { family: "secret", k } }));
  k.fill(0);
  assert.deepEqual([...success(second.exportKey(imported.handle, "raw"))], [1, 2, 3, 4]);
});

test("native adapters return failure values for foreign handles and native errors", () => {
  const provider = new NodeCryptoProvider();
  const foreign = {} as CryptoKeyHandle;
  const cipher = { name: "AES-CBC", iv: new Uint8Array(16) } as const;
  const mac = { name: "HMAC", hash: "SHA-256" } as const;
  assert.deepEqual(provider.exportKey(foreign, "raw"), { failure: "invalid-key" });
  assert.deepEqual(provider.exportComponents(foreign), { failure: "invalid-key" });
  assert.deepEqual(provider.encrypt(cipher, foreign, new Uint8Array(16)), { failure: "invalid-key" });
  assert.deepEqual(provider.decrypt(cipher, foreign, { bytes: new Uint8Array(16), tag: null }), { failure: "invalid-key" });
  assert.deepEqual(provider.sign(mac, foreign, new Uint8Array()), { failure: "invalid-key" });
  assert.equal(provider.verify(mac, foreign, { kind: "bytes", bytes: new Uint8Array(32) }, new Uint8Array()), false);
  // Deliberately violate the byte type to force a native createSecretKey exception.
  assert.deepEqual(provider.importKey({ format: "raw", family: "secret", bytes: {} as Uint8Array }), { failure: "invalid-key" });
  const key = secret(provider, new Uint8Array(16));
  assert.deepEqual(provider.encrypt(cipher, key.handle, new Uint8Array(15)), { failure: "operation" });
});

test("native AES-CBC does not add or remove padding", () => {
  // NIST SP 800-38A F.2.1, first block.
  // https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf
  const provider = new NodeCryptoProvider();
  const key = secret(provider, bytes("2b7e151628aed2a6abf7158809cf4f3c"));
  const parameters = { name: "AES-CBC", iv: bytes("000102030405060708090a0b0c0d0e0f") } as const;
  const input = bytes("6bc1bee22e409f96e93d7e117393172a");
  const encrypted = success(provider.encrypt(parameters, key.handle, input));
  assert.equal(hex(encrypted.bytes), "7649abac8119b246cee98e9b12e9197d");
  assert.equal(encrypted.tag, null);
  assertOwned(encrypted.bytes);
  assert.deepEqual(success(provider.decrypt(parameters, key.handle, encrypted)), input);
});

test("native AES-CTR agrees with the NIST full-width counter vector", () => {
  // NIST SP 800-38A F.5.1, first block.
  const provider = new NodeCryptoProvider();
  const key = secret(provider, bytes("2b7e151628aed2a6abf7158809cf4f3c"));
  const parameters = { name: "AES-CTR", counter: bytes("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"), counterLength: 128 } as const;
  const input = bytes("6bc1bee22e409f96e93d7e117393172a");
  const encrypted = success(provider.encrypt(parameters, key.handle, input));
  assert.equal(hex(encrypted.bytes), "874d6191b620e3261bef6864990db6ce");
  assert.deepEqual(success(provider.decrypt(parameters, key.handle, encrypted)), input);
});

// Each fixed answer was independently computed by native AES-128-ECB with a
// zero key over the explicitly listed counter blocks. Zero plaintext exposes
// those outputs directly, isolating counter-field adaptation from the cipher.
const wrapVectors = [
  {
    bits: 1,
    initial: "00000000000000000000000000000003",
    counters: "00000000000000000000000000000003 00000000000000000000000000000002",
    expected: "f795aaab494b5923f7fd89ff948bc1e00388dace60b6a392f328c2b971b2fe78",
  },
  {
    bits: 2,
    initial: "0000000000000000000000000000000f",
    counters: "0000000000000000000000000000000f 0000000000000000000000000000000c 0000000000000000000000000000000d 0000000000000000000000000000000e",
    expected: "a73f8d0437e0915fbce5d7a62d8dab0a5d11452b58ac50aa2eb3a195b61b87e5c65a6dd5d7f7a84065d5a17ff46273086002496db63fa4b91bee387fa3030c95",
  },
  {
    bits: 9,
    initial: "000000000000000000000000000003ff",
    counters: "000000000000000000000000000003ff 00000000000000000000000000000200",
    expected: "09836c44648b1f262e7b8bb6310e3c735f5ad3c42b9489557bb63bf49ecf5f8a",
  },
  {
    bits: 64,
    initial: "aabbccddeeff0011ffffffffffffffff",
    counters: "aabbccddeeff0011ffffffffffffffff aabbccddeeff00110000000000000000",
    expected: "7f0aa56a0fc659ff6aedea1f82e5a576581065877701bb710101243c3c0cbbdc",
  },
  {
    bits: 128,
    initial: "ffffffffffffffffffffffffffffffff",
    counters: "ffffffffffffffffffffffffffffffff 00000000000000000000000000000000",
    expected: "3f5b8cc9ea855a0afa7347d23e8d664e66e94bd4ef8a2c3b884cfa59ca342b2e",
  },
] as const;

for (const vector of wrapVectors) {
  test(`native AES-CTR resets only its ${vector.bits}-bit counter field at wrap`, () => {
    const provider = new NodeCryptoProvider();
    const key = secret(provider, new Uint8Array(16));
    const parameters = { name: "AES-CTR", counter: bytes(vector.initial), counterLength: vector.bits } as const;
    const input = new Uint8Array(vector.expected.length / 2);
    const encrypted = success(provider.encrypt(parameters, key.handle, input));
    assert.equal(hex(encrypted.bytes), vector.expected, vector.counters);
    assert.equal(hex(parameters.counter), vector.initial, "the borrowed counter stays unchanged");
    assert.deepEqual(success(provider.decrypt(parameters, key.handle, encrypted)), input);
    assertOwned(encrypted.bytes);
  });
}

test("native AES-CTR handles a partial final block after a counter-field wrap", () => {
  const provider = new NodeCryptoProvider();
  const key = secret(provider, new Uint8Array(16));
  const parameters = { name: "AES-CTR", counter: bytes(wrapVectors[0].initial), counterLength: 1 } as const;
  const encrypted = success(provider.encrypt(parameters, key.handle, new Uint8Array(17)));
  assert.equal(hex(encrypted.bytes), wrapVectors[0].expected.slice(0, 34));
});

test("native AES-CTR adaptation ignores late Math replacements", { skip: "rule 405266cf7 (call methods plainly): nts programs cannot redefine intrinsic methods, constructors, or prototypes" }, () => {
  const provider = new NodeCryptoProvider();
  const key = secret(provider, new Uint8Array(16));
  const parameters = { name: "AES-CTR", counter: bytes(wrapVectors[0].initial), counterLength: 1 } as const;
  const originalCeil = Math.ceil;
  const originalFloor = Math.floor;
  const originalMin = Math.min;
  let encrypted;
  try {
    Math.ceil = () => { throw new Error("late Math.ceil"); };
    Math.floor = () => { throw new Error("late Math.floor"); };
    Math.min = () => { throw new Error("late Math.min"); };
    encrypted = provider.encrypt(parameters, key.handle, new Uint8Array(32));
  } finally {
    Math.ceil = originalCeil;
    Math.floor = originalFloor;
    Math.min = originalMin;
  }
  assert.equal(hex(success(encrypted).bytes), wrapVectors[0].expected);
});

test("native AES-GCM returns a separate tag and never releases unauthenticated plaintext", () => {
  // NIST GCM zero-key, 96-bit zero-IV, one-zero-block example.
  const provider = new NodeCryptoProvider();
  const key = secret(provider, new Uint8Array(16));
  const parameters: CryptoAesGcmParameters = {
    name: "AES-GCM", iv: new Uint8Array(12), additionalData: new Uint8Array(), tagLength: 128,
  };
  const encrypted = success(provider.encrypt(parameters, key.handle, new Uint8Array(16)));
  assert.equal(hex(encrypted.bytes), "0388dace60b6a392f328c2b971b2fe78");
  assert.ok(encrypted.tag !== null);
  assert.equal(hex(encrypted.tag), "ab6e47d42cec13bdf53a67b21257bddf");
  assertOwned(encrypted.bytes);
  assertOwned(encrypted.tag);
  assert.notEqual(encrypted.bytes.buffer, encrypted.tag.buffer);
  assert.deepEqual(success(provider.decrypt(parameters, key.handle, encrypted)), new Uint8Array(16));
  encrypted.tag[0] = encrypted.tag[0]! ^ 1;
  assert.deepEqual(provider.decrypt(parameters, key.handle, encrypted), { failure: "operation" });
  assert.deepEqual(provider.decrypt(parameters, key.handle, { bytes: encrypted.bytes, tag: null }), { failure: "operation" });
});

test("native AES-KW uses RFC 3394's initial value and integrity check", () => {
  // https://www.rfc-editor.org/rfc/rfc3394#section-4.1
  const provider = new NodeCryptoProvider();
  const key = secret(provider, bytes("000102030405060708090a0b0c0d0e0f"));
  const input = bytes("00112233445566778899aabbccddeeff");
  const parameters = { name: "AES-KW" } as const;
  const encrypted = success(provider.encrypt(parameters, key.handle, input));
  assert.equal(hex(encrypted.bytes), "1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5");
  assert.equal(encrypted.tag, null);
  assert.deepEqual(success(provider.decrypt(parameters, key.handle, encrypted)), input);
  encrypted.bytes[0] = encrypted.bytes[0]! ^ 1;
  assert.deepEqual(provider.decrypt(parameters, key.handle, encrypted), { failure: "operation" });
});

test("native HMAC signs the RFC vector and verification returns only booleans", () => {
  // RFC 4231 §4.2, test case 1: https://www.rfc-editor.org/rfc/rfc4231#section-4.2
  const provider = new NodeCryptoProvider();
  const key = secret(provider, new Uint8Array(20).fill(0x0b));
  const parameters = { name: "HMAC", hash: "SHA-256" } as const;
  const input = new Uint8Array(Buffer.from("Hi There", "ascii"));
  const signature = success(provider.sign(parameters, key.handle, input));
  assert.ok(signature.kind === "bytes");
  assert.equal(hex(signature.bytes), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  assertOwned(signature.bytes);
  assert.equal(provider.verify(parameters, key.handle, signature, input), true);
  signature.bytes[0] = signature.bytes[0]! ^ 1;
  assert.equal(provider.verify(parameters, key.handle, signature, input), false);
  assert.equal(provider.verify(parameters, key.handle, { kind: "bytes", bytes: new Uint8Array(31) }, input), false);
  assert.equal(provider.verify(parameters, key.handle, { kind: "ecdsa", r: new Uint8Array(), s: new Uint8Array() }, input), false);
});
