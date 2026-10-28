// Web Cryptography §§18.4.4, 33.2–33.3 and 34.2–34.3:
// https://w3c.github.io/webcrypto/#algorithm-normalization-normalize-an-algorithm
// https://w3c.github.io/webcrypto/#hkdf-params
// https://w3c.github.io/webcrypto/#dfn-Pbkdf2Params
// Web IDL §§3.2.4.9 and 3.2.17: https://webidl.spec.whatwg.org/#es-dictionary
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DOMException } from "../src/core/errors.ts";
import { DigestAlgorithm, HkdfParams, Pbkdf2Params, normalizeAlgorithm } from "../src/crypto/algorithms.ts";

function notSupported(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotSupportedError";
}

for (const name of ["HKDF", "PBKDF2"] as const) {
  test(name + " normalizes to its typed parameters with each registered digest", () => {
    for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const) {
      const input = {
        name: name.toLowerCase(), hash: { name: hash.toLowerCase() },
        salt: new Uint8Array([1, 2]), info: new Uint8Array([3, 4]), iterations: 2,
      };
      const first = normalizeAlgorithm(input, "deriveBits");
      const second = normalizeAlgorithm(input, "deriveBits");
      assert.ok(first instanceof HkdfParams || first instanceof Pbkdf2Params);
      assert.ok(second instanceof HkdfParams || second instanceof Pbkdf2Params);
      assert.equal(first.name, name);
      assert.ok(first.hash instanceof DigestAlgorithm);
      assert.equal(first.hash.name, hash);
      assert.notEqual(first, second);
      assert.notEqual(first.hash, second.hash);
      assert.notEqual(first.hash, input.hash);
      assert.deepEqual([...first.salt], [1, 2]);
      if (name === "HKDF") {
        assert.ok(first instanceof HkdfParams);
        assert.deepEqual([...first.info], [3, 4]);
        assert.deepEqual(Object.keys(first), ["name", "hash", "salt", "info"]);
      } else {
        assert.ok(first instanceof Pbkdf2Params);
        assert.equal(first.iterations, 2);
        assert.deepEqual(Object.keys(first), ["name", "hash", "salt", "iterations"]);
      }
    }
  });

  test(name + " borrows primitive-hash inputs only when later script cannot run", () => {
    const salt = new Uint8Array([1, 2]);
    const info = new Uint8Array([3, 4]);
    const input = { name, hash: "SHA-256", salt, info, iterations: 1 };
    const borrowed = normalizeAlgorithm(input, "deriveBits");
    const copied = normalizeAlgorithm(input, "deriveBits", true);
    assert.ok(borrowed instanceof HkdfParams || borrowed instanceof Pbkdf2Params);
    assert.ok(copied instanceof HkdfParams || copied instanceof Pbkdf2Params);
    assert.equal(borrowed.salt, salt);
    assert.notEqual(copied.salt.buffer, salt.buffer);
    salt[0] = 9;
    info[0] = 8;
    assert.deepEqual([...borrowed.salt], [9, 2]);
    assert.deepEqual([...copied.salt], [1, 2]);
    if (borrowed instanceof HkdfParams && copied instanceof HkdfParams) {
      assert.equal(borrowed.info, info);
      assert.deepEqual([...borrowed.info], [8, 4]);
      assert.deepEqual([...copied.info], [3, 4]);
      assert.notEqual(copied.info.buffer, info.buffer);
    }
  });

  test(name + " snapshots only the supplied DataView and typed-array byte ranges", () => {
    const storage = new Uint8Array([99, 1, 2, 3, 4, 5, 88]);
    const result = normalizeAlgorithm({
      name, hash: "SHA-384", salt: new DataView(storage.buffer, 1, 3),
      info: storage.subarray(4, 6), iterations: 3,
    }, "deriveBits", true);
    assert.ok(result instanceof HkdfParams || result instanceof Pbkdf2Params);
    assert.deepEqual([...result.salt], [1, 2, 3]);
    assert.equal(result.salt.byteOffset, 0);
    assert.equal(result.salt.buffer.byteLength, 3);
    if (result instanceof HkdfParams) {
      assert.deepEqual([...result.info], [4, 5]);
      assert.equal(result.info.byteOffset, 0);
      assert.equal(result.info.buffer.byteLength, 2);
    }
  });

  test(name + " accepts detached BufferSources", () => {
    const salt = new DataView(new Uint8Array([9, 1, 2, 8]).buffer, 1, 2);
    const buffer = new ArrayBuffer(3);
    const detached = new DataView(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    for (const copyBuffers of [false, true]) {
      const result = normalizeAlgorithm({
        name, hash: "SHA-1", salt, info: detached, iterations: 1,
      }, "deriveBits", copyBuffers);
      assert.ok(result instanceof HkdfParams || result instanceof Pbkdf2Params);
      assert.deepEqual([...result.salt], [1, 2]);
      if (result instanceof HkdfParams) assert.equal(result.info.byteLength, 0);
      const empty = normalizeAlgorithm({
        name, hash: "SHA-1", salt: detached, info: buffer, iterations: 1,
      }, "deriveBits", copyBuffers);
      assert.ok(empty instanceof HkdfParams || empty instanceof Pbkdf2Params);
      assert.equal(empty.salt.byteLength, 0);
    }
  });

  test(name + " accepts foreign-realm BufferSources", { skip: "nts programs have one realm" }, () => {
    const foreign = runInNewContext("new DataView(new Uint8Array([9, 1, 2, 8]).buffer, 1, 2)") as DataView;
    for (const copyBuffers of [false, true]) {
      const result = normalizeAlgorithm({
        name, hash: "SHA-1", salt: foreign, info: new Uint8Array(0), iterations: 1,
      }, "deriveBits", copyBuffers);
      assert.ok(result instanceof HkdfParams || result instanceof Pbkdf2Params);
      assert.deepEqual([...result.salt], [1, 2]);
    }
  });

  test(name + " retains the first matching name despite the second dictionary name", () => {
    let nameReads = 0;
    const result = normalizeAlgorithm({
      get name() { return ++nameReads === 1 ? name.toLowerCase() : "AES-CBC"; },
      hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0), iterations: 0,
    }, "deriveBits");
    assert.equal(result.name, name);
    assert.equal(nameReads, 2);
    assert.ok(name === "HKDF" ? result instanceof HkdfParams : result instanceof Pbkdf2Params);
  });

  test(name + " rejects missing or invalid hash union values before later getters", () => {
    for (const hash of [undefined, Symbol("SHA-256")]) {
      assert.throws(() => normalizeAlgorithm({
        name, hash,
        get info() { throw new Error("must not read info"); },
        get iterations() { throw new Error("must not read iterations"); },
        get salt() { throw new Error("must not read salt"); },
      }, "deriveBits"), TypeError);
    }
  });

  test(name + " delays hash normalization until every outer member is converted", () => {
    for (const hash of [null, true, 12, 12n, "HMAC", "SHA256", " SHA-256"]) {
      const reads: string[] = [];
      assert.throws(() => normalizeAlgorithm({
        name, hash,
        get info() { reads.push("info"); return new Uint8Array(0); },
        get iterations() { reads.push("iterations"); return 1; },
        get salt() { reads.push("salt"); return new Uint8Array(0); },
      }, "deriveBits"), notSupported);
      assert.deepEqual(reads, [name === "HKDF" ? "info" : "iterations", "salt"]);
    }
  });

  test(name + " preserves a nested hash getter's thrown value", () => {
    const failure = new Error("hash getter");
    let reads = 0;
    assert.throws(() => normalizeAlgorithm({
      name,
      hash: { get name() { if (++reads === 2) throw failure; return "SHA-256"; } },
      salt: new Uint8Array(0), info: new Uint8Array(0), iterations: 1,
    }, "deriveBits"), error => error === failure);
    assert.equal(reads, 2);
  });

  test(name + " rejects invalid salts before recursive hash normalization", () => {
    const shared = new SharedArrayBuffer(4);
    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    for (const salt of [
      undefined, null, {}, [1, 2], shared, new Uint8Array(shared), new DataView(shared),
      resizable, new Uint8Array(resizable), new DataView(resizable),
    ]) {
      assert.throws(() => normalizeAlgorithm({
        name, hash: { get name() { throw new Error("must not normalize hash"); } },
        salt, info: new Uint8Array(0), iterations: 1,
      }, "deriveBits"), TypeError);
    }
  });
}

test("HKDF reads hash, info and salt lexicographically before recursive hash normalization", () => {
  const reads: string[] = [];
  const result = normalizeAlgorithm({
    get salt() { reads.push("salt"); return new Uint8Array(0); },
    get info() { reads.push("info"); return new Uint8Array(0); },
    get hash() {
      reads.push("hash");
      return { get name() {
        reads.push("hash.name");
        return { toString() { reads.push("hash.name.toString"); return "sha-512"; } };
      } };
    },
    get name() { reads.push("name"); return "hKdF"; },
  }, "deriveBits");
  assert.ok(result instanceof HkdfParams);
  assert.equal(result.hash.name, "SHA-512");
  assert.deepEqual(reads, [
    "name", "name", "hash", "info", "salt",
    "hash.name", "hash.name.toString", "hash.name", "hash.name.toString",
  ]);
});

test("PBKDF2 reads hash, iterations and salt lexicographically before recursive hash normalization", () => {
  const reads: string[] = [];
  const result = normalizeAlgorithm({
    get salt() { reads.push("salt"); return new Uint8Array(0); },
    get iterations() {
      reads.push("iterations");
      return { [Symbol.toPrimitive](hint: string) { reads.push(hint); return 2.9; } };
    },
    get hash() { reads.push("hash"); return { get name() { reads.push("hash.name"); return "sha-256"; } }; },
    get name() { reads.push("name"); return "pBkDf2"; },
  }, "deriveBits");
  assert.ok(result instanceof Pbkdf2Params);
  assert.equal(result.iterations, 2);
  assert.deepEqual(reads, ["name", "name", "hash", "iterations", "number", "salt", "hash.name", "hash.name"]);
});

test("HKDF captures salt and info after nested hash mutations in both copying modes", () => {
  for (const copyBuffers of [false, true]) {
    const salt = new Uint8Array([1, 2]);
    const info = new Uint8Array([3, 4]);
    let hashReads = 0;
    const result = normalizeAlgorithm({
      name: "HKDF",
      hash: { get name() { salt[0] = ++hashReads + 4; info[0] = hashReads + 6; return "SHA-256"; } },
      get info() { salt[1] = 8; return info; },
      get salt() { info[1] = 9; return salt; },
    }, "deriveBits", copyBuffers);
    assert.ok(result instanceof HkdfParams);
    assert.deepEqual([...result.salt], [6, 8]);
    assert.deepEqual([...result.info], [8, 9]);
    assert.equal(hashReads, 2);
  }
});

test("PBKDF2 snapshots salt after outer conversion but before nested hash mutations in both copying modes", () => {
  for (const copyBuffers of [false, true]) {
    const salt = new Uint8Array([1, 2]);
    const result = normalizeAlgorithm({
      name: "PBKDF2",
      hash: { get name() { salt.fill(9); return "SHA-256"; } },
      get iterations() { salt[0] = 3; return 1; },
      get salt() { salt[1] = 4; return salt; },
    }, "deriveBits", copyBuffers);
    assert.ok(result instanceof Pbkdf2Params);
    assert.deepEqual([...result.salt], [3, 4]);
    assert.deepEqual([...salt], [9, 9]);
    assert.notEqual(result.salt.buffer, salt.buffer);
  }
});

test("nested hash detachment precedes HKDF snapshots but follows the PBKDF2 salt snapshot", () => {
  for (const name of ["HKDF", "PBKDF2"] as const) {
    for (const copyBuffers of [false, true]) {
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const salt = new DataView(buffer, 1, 2);
      let hashReads = 0;
      const result = normalizeAlgorithm({
        name, salt, info: buffer, iterations: 1,
        hash: { get name() {
          if (++hashReads === 1) structuredClone(buffer, { transfer: [buffer] });
          return "SHA-256";
        } },
      }, "deriveBits", copyBuffers);
      assert.ok(result instanceof HkdfParams || result instanceof Pbkdf2Params);
      assert.deepEqual([...result.salt], name === "HKDF" ? [] : [2, 3]);
      if (result instanceof HkdfParams) assert.equal(result.info.byteLength, 0);
      assert.equal(hashReads, 2);
    }
  }
});

test("HKDF rejects invalid info before reading salt or normalizing hash", () => {
  const shared = new SharedArrayBuffer(1);
  const resizable = new ArrayBuffer(1, { maxByteLength: 2 });
  for (const info of [
    undefined, null, [1], {}, shared, new Uint8Array(shared), new DataView(shared),
    resizable, new Uint8Array(resizable), new DataView(resizable),
  ]) {
    assert.throws(() => normalizeAlgorithm({
      name: "HKDF", hash: { get name() { throw new Error("must not normalize hash"); } }, info,
      get salt() { throw new Error("must not read salt"); },
    }, "deriveBits"), TypeError);
  }
});

test("PBKDF2 unsigned-long iterations truncate before range checks and preserve zero for operation policy", () => {
  for (const [input, expected] of [
    [0, 0], [-0, 0], [-0.9, 0], [null, 0], [false, 0], [true, 1],
    ["2.9", 2], [[3], 3], [4_294_967_295.5, 4_294_967_295],
  ] as const) {
    const result = normalizeAlgorithm({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(0), iterations: input }, "deriveBits");
    assert.ok(result instanceof Pbkdf2Params);
    assert.equal(result.iterations, expected);
    assert.equal(Object.is(result.iterations, -0), false);
  }
});

test("PBKDF2 iteration conversion errors precede salt and nested hash access", () => {
  for (const iterations of [undefined, NaN, Infinity, -Infinity, -1, 4_294_967_296, 1n, Symbol("1"), {}]) {
    assert.throws(() => normalizeAlgorithm({
      name: "PBKDF2", iterations,
      hash: { get name() { throw new Error("must not normalize hash"); } },
      get salt() { throw new Error("must not read salt"); },
    }, "deriveBits"), TypeError);
  }
  const failure = new Error("iteration conversion");
  assert.throws(() => normalizeAlgorithm({
    name: "PBKDF2", iterations: { valueOf() { throw failure; } },
    hash: { get name() { throw new Error("must not normalize hash"); } },
    get salt() { throw new Error("must not read salt"); },
  }, "deriveBits"), error => error === failure);
});
