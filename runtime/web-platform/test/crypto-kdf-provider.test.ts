// Native capability controls: RFC 5869 Appendix A and RFC 6070 §2.
// Only native crypto primitives are used as additional controls; no Web Crypto.
import assert from "node:assert/strict";
import { hkdfSync, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import type { CryptoDigestName, CryptoFailure, CryptoKeyHandle, CryptoKeyRecord } from "../src/provider/crypto.ts";
import { hkdfFixture, pbkdf2Fixture } from "./kdf-fixtures.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

function success<T extends object>(result: T | CryptoFailure): T {
  if ("failure" in result) assert.fail("Unexpected native failure: " + result.failure);
  return result;
}

function secret(provider: NodeCryptoProvider, bytes: Uint8Array): CryptoKeyRecord {
  return success(provider.importKey({ format: "raw", family: "secret", bytes }));
}

function assertOwned(bytes: Uint8Array): void {
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.byteLength, bytes.buffer.byteLength);
}

function offsetView(bytes: Uint8Array): Uint8Array {
  const backing = new Uint8Array(bytes.byteLength + 9).fill(0xa5);
  backing.set(bytes, 3);
  return backing.subarray(3, 3 + bytes.byteLength);
}

for (let index = 0; index < 7; index++) {
  test(`native HKDF matches RFC 5869 A.${index + 1} exactly`, () => {
    const provider = new NodeCryptoProvider();
    const fixture = hkdfFixture(index);
    const key = secret(provider, fixture.key);
    const output = success(provider.derive({
      name: "HKDF", hash: fixture.hash, salt: fixture.salt, info: fixture.info, byteLength: fixture.length,
    }, key.handle));
    assertOwned(output);
    assert.deepEqual(output, fixture.output);
  });
}

for (let index = 0; index < 5; index++) {
  test(`native PBKDF2 matches practical RFC 6070 vector ${index + 1} exactly`, () => {
    const provider = new NodeCryptoProvider();
    const fixture = pbkdf2Fixture(index);
    const key = secret(provider, fixture.key);
    const output = success(provider.derive({
      name: "PBKDF2", hash: fixture.hash, salt: fixture.salt, iterations: fixture.iterations, byteLength: fixture.length,
    }, key.handle));
    assertOwned(output);
    assert.deepEqual(output, fixture.output);
  });
}

const hashes = [["SHA-1", "sha1", 20], ["SHA-256", "sha256", 32], ["SHA-384", "sha384", 48], ["SHA-512", "sha512", 64]] as const;
for (const [hash, nativeHash, width] of hashes) {
  test(`native HKDF ${hash} handles empty and arbitrary octets across output blocks`, () => {
    const provider = new NodeCryptoProvider();
    for (const bytes of [new Uint8Array(0), new Uint8Array([0, 0x80, 0xff, 0xc0, 0xaf, 1, 0, 2]), new Uint8Array(129).fill(0xab)]) {
      const key = secret(provider, bytes);
      for (const salt of [new Uint8Array(0), new Uint8Array([0xff, 0, 0x80, 0xc0, 1])]) {
        const info = new Uint8Array([0, 0xff, 0x80, 1]);
        for (const byteLength of [1, width - 1, width, width + 1, width * 2 + 3]) {
          const output = success(provider.derive({ name: "HKDF", hash, salt, info, byteLength }, key.handle));
          assertOwned(output);
          assert.deepEqual(output, new Uint8Array(hkdfSync(nativeHash, bytes, salt, info, byteLength)));
        }
      }
    }
  });

  test(`native PBKDF2 ${hash} uses binary passwords including empty, NUL and long inputs`, () => {
    const provider = new NodeCryptoProvider();
    for (const bytes of [new Uint8Array(0), new Uint8Array([0, 0x80, 0xff, 0xc0, 0xaf, 1, 0, 2]), new Uint8Array(129).fill(0xab)]) {
      const key = secret(provider, bytes);
      for (const salt of [new Uint8Array(0), new Uint8Array([0xff, 0, 0x80, 0xc0, 1])]) {
        for (const byteLength of [1, width - 1, width, width + 1, width * 2 + 3]) {
          const output = success(provider.derive({ name: "PBKDF2", hash, salt, iterations: 2, byteLength }, key.handle));
          assertOwned(output);
          assert.deepEqual(output, new Uint8Array(pbkdf2Sync(bytes, salt, 2, byteLength, nativeHash)));
        }
      }
    }
  });

  test(`native HKDF ${hash} enforces the RFC maximum of 255 digest blocks`, () => {
    const provider = new NodeCryptoProvider();
    const bytes = new Uint8Array([1, 2, 3]);
    const key = secret(provider, bytes);
    const salt = new Uint8Array(0);
    const info = new Uint8Array(0);
    const maximum = width * 255;
    const output = success(provider.derive({ name: "HKDF", hash, salt, info, byteLength: maximum }, key.handle));
    assertOwned(output);
    assert.equal(output.byteLength, maximum);
    assert.deepEqual(output, new Uint8Array(hkdfSync(nativeHash, bytes, salt, info, maximum)));
    assert.deepEqual(provider.derive({ name: "HKDF", hash, salt, info, byteLength: maximum + 1 }, key.handle), { failure: "operation" });
  });
}

test("native secret import preserves empty inputs and reports their actual bit length", () => {
  const provider = new NodeCryptoProvider();
  for (const length of [0, 1, 129]) {
    const key = secret(provider, new Uint8Array(length));
    assert.deepEqual(key.info, { family: "secret", type: "secret", length: length * 8 });
    assert.deepEqual(Object.keys(key.handle), []);
    assert.deepEqual(success(provider.exportKey(key.handle, "raw")), new Uint8Array(length));
  }
});

test("native KDFs borrow the exact input views and return independently owned outputs", () => {
  const provider = new NodeCryptoProvider();
  for (const name of ["HKDF", "PBKDF2"] as const) {
    const fixture = name === "HKDF" ? hkdfFixture() : pbkdf2Fixture(4);
    const input = offsetView(fixture.key);
    const key = secret(provider, input);
    input.fill(0);
    const salt = offsetView(fixture.salt);
    const info = offsetView(hkdfFixture().info);
    const saltBefore = new Uint8Array(salt.buffer);
    const infoBefore = new Uint8Array(info.buffer);
    const parameters = name === "HKDF"
      ? { name, hash: fixture.hash, salt, info, byteLength: fixture.length }
      : { name, hash: fixture.hash, salt, iterations: 4096, byteLength: fixture.length };
    const first = success(provider.derive(parameters, key.handle));
    const second = success(provider.derive(parameters, key.handle));
    assertOwned(first); assertOwned(second);
    assert.deepEqual(first, fixture.output);
    assert.deepEqual(second, fixture.output);
    assert.notEqual(first.buffer, second.buffer);
    assert.notEqual(first.buffer, salt.buffer);
    assert.notEqual(first.buffer, info.buffer);
    first.fill(0);
    assert.deepEqual(second, fixture.output);
    assert.deepEqual(new Uint8Array(salt.buffer), saltBefore);
    assert.deepEqual(new Uint8Array(info.buffer), infoBefore);
    assert.deepEqual(success(provider.derive(parameters, key.handle)), fixture.output);
  }
});

test("native HKDF zero output validates through one native derivation and owns an empty buffer", () => {
  const provider = new NodeCryptoProvider();
  const empty = new Uint8Array(0);
  const key = secret(provider, empty);
  for (const [hash, nativeHash] of hashes) {
    assert.throws(() => hkdfSync(nativeHash, empty, empty, empty, 0), /Deriving bits failed/);
    const parameters = { name: "HKDF", hash, salt: empty, info: empty, byteLength: 0 } as const;
    const first = success(provider.derive(parameters, key.handle));
    const second = success(provider.derive(parameters, key.handle));
    assertOwned(first); assertOwned(second);
    assert.equal(first.byteLength, 0);
    assert.notEqual(first.buffer, second.buffer);
    assert.notEqual(first.buffer, empty.buffer);
    assert.deepEqual(provider.derive({ ...parameters, info: new Uint8Array(1025) }, key.handle), { failure: "operation" });
    assert.deepEqual(provider.derive({ ...parameters, hash: "unsupported-kdf-hash" as CryptoDigestName }, key.handle), { failure: "operation" });
    assert.deepEqual(provider.derive(parameters, {} as CryptoKeyHandle), { failure: "invalid-key" });
  }
});

test("Node HKDF fixture limitation: info over 1024 octets returns an operation failure", () => {
  // https://nodejs.org/download/release/v24.20.0/docs/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen
  // RFC 5869 and Web Crypto impose no such info-size cap; shared code does not add one.
  const provider = new NodeCryptoProvider();
  const bytes = new Uint8Array([1]);
  const key = secret(provider, bytes);
  const salt = new Uint8Array(0);
  const info = new Uint8Array(1024);
  const output = success(provider.derive({ name: "HKDF", hash: "SHA-256", salt, info, byteLength: 32 }, key.handle));
  assert.deepEqual(output, new Uint8Array(hkdfSync("sha256", bytes, salt, info, 32)));
  assert.deepEqual(provider.derive({ name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array(1025), byteLength: 32 }, key.handle), { failure: "operation" });
});

test("Node PBKDF2 fixture limitation: iterations above 2^31-1 return an operation failure", () => {
  // Node's native iteration field is signed; Web Crypto's unsigned-long range
  // extends to 2^32-1. Do not spend billions of iterations testing the accepted cap.
  const provider = new NodeCryptoProvider();
  const bytes = new Uint8Array([1]);
  const key = secret(provider, bytes);
  const salt = new Uint8Array(0);
  assert.deepEqual(success(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 2, byteLength: 1 }, key.handle)),
    new Uint8Array(pbkdf2Sync(bytes, salt, 2, 1, "sha256")));
  for (const iterations of [0x80000000, 0xffffffff]) {
    assert.throws(() => pbkdf2Sync(bytes, salt, iterations, 1, "sha256"), /2147483647/);
    assert.deepEqual(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt, iterations, byteLength: 1 }, key.handle), { failure: "operation" });
  }
});

test("native KDF argument and digest failures are returned as values", () => {
  const provider = new NodeCryptoProvider();
  const key = secret(provider, new Uint8Array([1]));
  const empty = new Uint8Array(0);
  for (const byteLength of [-1, 0.5, NaN, Infinity, 0x80000000]) {
    assert.deepEqual(provider.derive({ name: "HKDF", hash: "SHA-256", salt: empty, info: empty, byteLength }, key.handle), { failure: "operation" });
    assert.deepEqual(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt: empty, iterations: 1, byteLength }, key.handle), { failure: "operation" });
  }
  for (const iterations of [0, -1, 0.5, NaN, Infinity]) {
    assert.deepEqual(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt: empty, iterations, byteLength: 1 }, key.handle), { failure: "operation" });
  }
  const hash = "unsupported-kdf-hash" as CryptoDigestName;
  assert.deepEqual(provider.derive({ name: "HKDF", hash, salt: empty, info: empty, byteLength: 1 }, key.handle), { failure: "operation" });
  assert.deepEqual(provider.derive({ name: "PBKDF2", hash, salt: empty, iterations: 1, byteLength: 1 }, key.handle), { failure: "operation" });
  // This native path rejects zero; shared PBKDF2 returns empty after its own checks.
  assert.deepEqual(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt: empty, iterations: 1, byteLength: 0 }, key.handle), { failure: "operation" });
});

test("native KDFs reject unknown and asymmetric handles as invalid-key values", () => {
  const provider = new NodeCryptoProvider();
  const pair = success(provider.generateKeyPair({ family: "OKP", namedCurve: "Ed25519" }));
  const empty = new Uint8Array(0);
  for (const key of [{} as CryptoKeyHandle, pair.publicKey.handle, pair.privateKey.handle]) {
    assert.deepEqual(provider.derive({ name: "HKDF", hash: "SHA-256", salt: empty, info: empty, byteLength: 1 }, key), { failure: "invalid-key" });
    assert.deepEqual(provider.derive({ name: "PBKDF2", hash: "SHA-256", salt: empty, iterations: 1, byteLength: 1 }, key), { failure: "invalid-key" });
  }
});
