// Modern Algorithms §§3.2.6–3.3 and Web IDL §§3.6, 3.7.7.
// Availability checks inspect metadata; all cryptographic operations in the
// recording capability deliberately fail if a supports() implementation calls them.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv } from "node:crypto";
import type { CipherGCMTypes } from "node:crypto";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { SubtleCrypto } from "../src/index.ts";
import { installWebPlatformRuntime, VirtualScheduler, WebPlatformRuntime } from "../src/provider.ts";
import type { CryptoFailure, CryptoKeyHandle, CryptoSupportQuery, RandomSource } from "../src/provider.ts";
import { hasWebPlatformRuntime } from "../src/provider/environment.ts";
import { createCryptoKey, KeyAlgorithm } from "../src/crypto/crypto-key.ts";
import { cryptoCapability } from "../src/crypto/capability.ts";
import { EcKeyAlgorithm } from "../src/crypto/ec-key.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class NoRandom implements RandomSource {
  calls = 0;
  fill(_bytes: Uint8Array): never { this.calls++; throw new Error("supports must not request entropy"); }
}

class MetadataOnlyProvider extends NodeCryptoProvider {
  readonly queries: CryptoSupportQuery[] = [];
  readonly trace: string[] = [];
  readonly results: (boolean | CryptoFailure)[] = [];
  native = false;
  primitiveCalls = 0;

  override supports(query: CryptoSupportQuery): boolean | CryptoFailure {
    this.queries.push(query);
    this.trace.push("native:" + query.operation + ":" + query.parameters.name);
    return this.results[this.queries.length - 1] ?? (this.native ? super.supports(query) : true);
  }

  private primitive(): never { this.primitiveCalls++; throw new Error("supports must not execute a primitive"); }
  override digest(): never { return this.primitive(); }
  override digestXof(): never { return this.primitive(); }
  override importKey(): never { return this.primitive(); }
  override exportKey(): never { return this.primitive(); }
  override exportComponents(): never { return this.primitive(); }
  override generateKeyPair(): never { return this.primitive(); }
  override encrypt(): never { return this.primitive(); }
  override decrypt(): never { return this.primitive(); }
  override sign(): never { return this.primitive(); }
  override verify(): never { return this.primitive(); }
  override derive(): never { return this.primitive(); }
  override getPublicKey(): never { return this.primitive(); }
  override encapsulate(): never { return this.primitive(); }
  override decapsulate(): never { return this.primitive(); }
}

function fixture(t: TestContext, native = false): {
  provider: MetadataOnlyProvider; random: NoRandom; scheduler: VirtualScheduler; runtime: WebPlatformRuntime;
} {
  const provider = new MetadataOnlyProvider();
  provider.native = native;
  const random = new NoRandom();
  const scheduler = new VirtualScheduler();
  const runtime = new WebPlatformRuntime({ ...createHostNodePrimitives(), random, scheduler }, { crypto: provider });
  installWebPlatformRuntime(runtime);
  t.after(() => {
    assert.equal(provider.primitiveCalls, 0);
    assert.equal(random.calls, 0);
    assert.equal(scheduler.hasPending, false);
    runtime.close();
  });
  return { provider, random, scheduler, runtime };
}

function agreementKey(name: "ECDH" | "X25519" | "X448", type: "public" | "private" = "public", curve: "P-256" | "P-384" | "P-521" = "P-256") {
  // Supports never inspects or submits this handle. Only genuine package slots
  // are used, with no generated/imported key or cryptographic setup operation.
  return createCryptoKey(type, true, name === "ECDH" ? new EcKeyAlgorithm(name, curve) : new KeyAlgorithm(name), [], {} as CryptoKeyHandle);
}

function hkdf() { return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new Uint8Array() }; }
function pbkdf2() { return { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(), iterations: 1 }; }
function argon2(name = "Argon2id") {
  return { name, nonce: new Uint8Array(8), parallelism: 1, memory: 8, passes: 1 };
}

test("supports reports no runtime and no crypto capability without consulting ambient Node crypto", () => {
  assert.equal(hasWebPlatformRuntime(), false);
  assert.equal(SubtleCrypto.supports("digest", "SHA-256"), false);
  let reads = 0;
  const runtime = new WebPlatformRuntime(createHostNodePrimitives());
  installWebPlatformRuntime(runtime);
  try {
    assert.equal(SubtleCrypto.supports("digest", { get name() { reads++; return "SHA-256"; } }), false);
    assert.equal(reads, 2, "normalization still precedes the absent-capability result");
    assert.equal(typeof globalThis.crypto.subtle.digest, "function");
  } finally { runtime.close(); }
});

test("static supports uses the currently installed runtime and accepts detached or inherited calls", (t) => {
  const first = fixture(t);
  const supports = SubtleCrypto.supports;
  assert.equal(supports("digest", "SHA-256"), true);
  class DerivedSubtleCrypto extends SubtleCrypto {}
  assert.equal(DerivedSubtleCrypto.supports("digest", "SHA-256"), true);
  assert.equal(supports.call(null, "digest", "SHA-256"), true);
  const second = fixture(t);
  second.provider.results.push(false);
  assert.equal(supports("digest", "SHA-256"), false);
  assert.equal(first.provider.queries.length, 3);
  assert.equal(second.provider.queries.length, 1);
  installWebPlatformRuntime(first.runtime);
  assert.equal(supports("digest", "SHA-256"), true);
});

test("capability lookup uses internal identity without reading a public subtle getter", (t) => {
  const { runtime, provider } = fixture(t);
  assert.ok(runtime.crypto);
  assert.equal(cryptoCapability(runtime.crypto), provider);
  class PublicGetter {
    reads = 0;
    get subtle(): never { this.reads++; throw new Error("public subtle getter must remain unread"); }
  }
  const unregistered = new PublicGetter();
  assert.equal(cryptoCapability(unregistered), undefined);
  assert.equal(unregistered.reads, 0);
  assert.equal(SubtleCrypto.supports("digest", "SHA-256"), true);
  assert.equal(provider.queries.length, 1);
});

test("native false and failure values become false after one metadata query", (t) => {
  const { provider } = fixture(t);
  provider.results.push(false, { failure: "operation" }, { failure: "invalid-key" }, true);
  for (const expected of [false, false, false, true]) assert.equal(SubtleCrypto.supports("digest", "sha3-256"), expected);
  assert.equal(provider.queries.length, 4);
  assert.deepEqual(provider.queries[0], { operation: "digest", parameters: { kind: "digest", name: "SHA3-256" }, length: null });
});

test("required arguments and all overload conversions happen before the method's false checks", (t) => {
  const { provider } = fixture(t);
  const invoke: (...args: unknown[]) => boolean = SubtleCrypto.supports;
  assert.throws(() => invoke(), TypeError);
  assert.throws(() => invoke("digest"), TypeError);
  for (const value of [-1, 2 ** 32, NaN, Infinity, -Infinity]) {
    assert.throws(() => SubtleCrypto.supports("invalid", "SHA-256", value), TypeError);
    assert.throws(() => SubtleCrypto.supports("digest", "SHA-256", value), TypeError);
  }
  assert.throws(() => SubtleCrypto.supports(Symbol(), "SHA-256"), TypeError);
  assert.throws(() => SubtleCrypto.supports("invalid", Symbol()), TypeError);
  assert.throws(() => SubtleCrypto.supports("invalid", "SHA-256", Symbol()), TypeError);
  assert.equal(provider.queries.length, 0);
});

test("the third argument selects an overload by type rather than by operation", (t) => {
  fixture(t);
  assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), 256), true);
  for (const extra of [undefined, null, "256", 256n, true, new Number(256)]) {
    assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), extra), false);
  }
  for (const extra of [undefined, null, false, 1n, -1n, "ignored", { get name(): never { throw new Error("unused additional algorithm"); } }]) {
    assert.equal(SubtleCrypto.supports("digest", "SHA-256", extra), true);
  }
  assert.equal(SubtleCrypto.supports("wrapKey", "AES-KW"), true);
  assert.equal(SubtleCrypto.supports("wrapKey", "AES-KW", 32), true);
  assert.equal(SubtleCrypto.supports("wrapKey", "AES-KW", "SHA-256"), false);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf()), false);
  assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), 8.9), true);
  assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), -0.9), true);
});

test("IDL conversion order is operation then algorithm then additional algorithm", (t) => {
  const { provider } = fixture(t);
  const trace: string[] = [];
  assert.equal(SubtleCrypto.supports({ toString() { trace.push("operation"); return "digest"; } },
    { get name() { trace.push("name"); return "SHA-256"; } },
    { toString(): never { throw new Error("object union conversion must preserve the object"); } }), true);
  assert.deepEqual(trace, ["operation", "name", "name"]);
  assert.equal(provider.queries.length, 1);
  assert.equal(SubtleCrypto.supports("invalid", { get name(): never { throw new Error("invalid operation skips normalization"); } }), false);
});

test("invalid algorithms, dictionaries and unsupported operations never query native support", (t) => {
  const { provider } = fixture(t);
  for (const [operation, algorithm] of [
    ["DIGEST", "SHA-256"], ["", "SHA-256"], ["encrypt", "SHA-256"], ["digest", "AES-GCM"],
    ["generateKey", "AES-GCM"], ["generateKey", { name: "AES-GCM", length: 100 }],
    ["generateKey", { name: "HMAC", hash: "SHA-256", length: 0 }],
    ["generateKey", { name: "HMAC", hash: "cSHAKE128" }],
    ["importKey", { name: "ECDH", namedCurve: "P-257" }],
    ["sign", { name: "ECDSA", hash: "bad" }], ["encrypt", {}],
    ["digest", { get name(): never { throw new Error("author failure"); } }],
    ["deriveBits", { name: "X25519", public: {} }],
  ]) assert.equal(SubtleCrypto.supports(operation, algorithm), false);
  for (const name of ["TurboSHAKE128", "TurboSHAKE256", "KT128", "KT256", "KangarooTwelve", "ML-KEM-768-X25519", "SLH-DSA-SHA2-128s"]) {
    for (const operation of ["digest", "generateKey", "encapsulateBits", "sign", "getPublicKey"]) {
      assert.equal(SubtleCrypto.supports(operation, { name, outputLength: 256 }), false);
    }
  }
  assert.equal(provider.queries.length, 0);
});

test("all fixed digests and XOF metadata use canonical names without reading or copying bytes", (t) => {
  const { provider } = fixture(t, true);
  for (const name of ["SHA-1", "SHA-256", "SHA-384", "SHA-512", "SHA3-256", "SHA3-384", "SHA3-512"]) {
    assert.equal(SubtleCrypto.supports("digest", name.toLowerCase()), true);
  }
  const bytes = new Uint8Array(24);
  for (const name of ["cSHAKE128", "cSHAKE256"]) {
    assert.equal(SubtleCrypto.supports("digest", { name, outputLength: 257, functionName: bytes.subarray(1, 4), customization: new DataView(bytes.buffer, 8, 5) }), true);
    assert.deepEqual(provider.queries.at(-1)?.parameters, { kind: "cshake", name, outputBits: 257, functionNameBytes: 3, customizationBytes: 5 });
    assert.equal(SubtleCrypto.supports("digest", { name, outputLength: 0 }), true);
    assert.equal(SubtleCrypto.supports("digest", { name, outputLength: 256, customization: new Uint8Array(513) }), false);
    assert.equal(SubtleCrypto.supports("digest", { name, outputLength: 256, functionName: new Uint8Array(513) }), true);
  }
});

test("HMAC and KMAC keep key-length, output-length and native customization policies separate", (t) => {
  fixture(t, true);
  assert.equal(SubtleCrypto.supports("generateKey", { name: "HMAC", hash: "SHA3-256" }), false);
  assert.equal(SubtleCrypto.supports("generateKey", { name: "HMAC", hash: "SHA3-256", length: 256 }), true);
  assert.equal(SubtleCrypto.supports("importKey", { name: "HMAC", hash: "SHA3-256" }), true);
  for (const name of ["KMAC128", "KMAC256"]) {
    for (const length of [0, 1, 128, 256, 4104]) assert.equal(SubtleCrypto.supports("generateKey", { name, length }), true);
    for (const outputLength of [0, 8, 256, 2_097_151 * 8]) {
      for (const operation of ["sign", "verify"]) assert.equal(SubtleCrypto.supports(operation, { name, outputLength }), true);
    }
    for (const outputLength of [1, 257, 2_097_152 * 8]) assert.equal(SubtleCrypto.supports("sign", { name, outputLength }), false);
    assert.equal(SubtleCrypto.supports("verify", { name, outputLength: 256, customization: new Uint8Array(513) }), false);
  }
});

test("AES and ChaCha20 metadata preserve all shared length and tag boundaries", (t) => {
  const { provider } = fixture(t, true);
  for (const name of ["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW", "AES-OCB"]) {
    for (const length of [128, 192, 256]) assert.equal(SubtleCrypto.supports("generateKey", { name, length }), true);
    for (const length of [0, 64, 127, 129, 255, 257]) assert.equal(SubtleCrypto.supports("generateKey", { name, length }), false);
    assert.equal(SubtleCrypto.supports("importKey", name), true);
    assert.equal(SubtleCrypto.supports("exportKey", name), true);
  }
  for (const operation of ["encrypt", "decrypt"]) {
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-CBC", iv: new Uint8Array(16) }), true);
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-CBC", iv: new Uint8Array(15) }), false);
    for (const length of [1, 128]) assert.equal(SubtleCrypto.supports(operation, { name: "AES-CTR", counter: new Uint8Array(16), length }), true);
    for (const length of [0, 129]) assert.equal(SubtleCrypto.supports(operation, { name: "AES-CTR", counter: new Uint8Array(16), length }), false);
    for (const tagLength of [32, 64, 96, 104, 112, 120, 128]) assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: new Uint8Array(12), tagLength }), true);
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: new Uint8Array(12), tagLength: 100 }), false);
    for (const tagLength of [64, 96, 128]) {
      assert.equal(SubtleCrypto.supports(operation, { name: "AES-OCB", iv: new Uint8Array(15), tagLength }), true);
    }
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-OCB", iv: new Uint8Array(16) }), false);
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-OCB", iv: new Uint8Array(12), tagLength: 104 }), false);
    assert.equal(SubtleCrypto.supports(operation, { name: "ChaCha20-Poly1305", iv: new Uint8Array(12) }), true);
    assert.equal(SubtleCrypto.supports(operation, { name: "ChaCha20-Poly1305", iv: new Uint8Array(11) }), false);
    assert.equal(SubtleCrypto.supports(operation, { name: "ChaCha20-Poly1305", iv: new Uint8Array(12), tagLength: 96 }), false);
  }
  assert.equal(SubtleCrypto.supports("generateKey", "ChaCha20-Poly1305"), true);
  assert.equal(provider.queries.at(-1)?.parameters.kind, "cipher");
});

test("empty OCB IV is a native capability limit and does not become shared draft policy", (t) => {
  const { provider } = fixture(t);
  const algorithm = { name: "AES-OCB", iv: new Uint8Array() };
  assert.equal(SubtleCrypto.supports("encrypt", algorithm), true);
  provider.native = true;
  assert.equal(SubtleCrypto.supports("encrypt", algorithm), false);
  assert.equal(provider.queries.length, 2, "the draft-valid parameter reaches each provider");
  assert.equal(SubtleCrypto.supports("encrypt", { name: "AES-OCB", iv: new Uint8Array(1) }), true);
});

test("GCM supports reports the native 128-byte IV maximum without narrowing shared policy", (t) => {
  const { provider } = fixture(t);
  const accepted = new Uint8Array(128);
  const rejected = new Uint8Array(129);
  for (const bits of [128, 192, 256]) {
    const name = "aes-" + bits + "-gcm" as CipherGCMTypes;
    const key = new Uint8Array(bits / 8);
    // Explicit native controls establish the backend boundary independently of
    // the metadata query. The supports implementation never runs these probes.
    const cipher = createCipheriv(name, key, accepted);
    const encrypted = cipher.final();
    const decipher = createDecipheriv(name, key, accepted);
    decipher.setAuthTag(cipher.getAuthTag());
    assert.equal(decipher.update(encrypted).byteLength + decipher.final().byteLength, 0);
    assert.throws(() => createCipheriv(name, key, rejected), { code: "ERR_CRYPTO_INVALID_IV" });
    assert.throws(() => createDecipheriv(name, key, rejected), { code: "ERR_CRYPTO_INVALID_IV" });
  }
  for (const operation of ["encrypt", "decrypt"]) {
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: accepted }), true);
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: rejected }), true);
  }
  provider.native = true;
  for (const operation of ["encrypt", "decrypt"]) {
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: accepted }), true);
    assert.equal(SubtleCrypto.supports(operation, { name: "AES-GCM", iv: rejected }), false);
  }
  assert.equal(provider.queries.length, 8, "both draft-valid lengths reach the selected capability");
});

test("RSA support separates shared mathematical bounds from native exponent and modulus limits", (t) => {
  const { provider } = fixture(t, true);
  for (const name of ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"]) {
    const base = { name, hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
    assert.equal(SubtleCrypto.supports("generateKey", base), true);
    assert.equal(SubtleCrypto.supports("generateKey", { ...base, modulusLength: 4, publicExponent: new Uint8Array([3]) }), false);
    assert.equal(SubtleCrypto.supports("generateKey", { ...base, publicExponent: new Uint8Array([1, 0, 0, 0, 1]) }), false);
    assert.equal(SubtleCrypto.supports("generateKey", { ...base, publicExponent: new Uint8Array([0, 0, 1, 0, 1]) }), true);
    const before = provider.queries.length;
    for (const exponent of [[], [0], [1], [2], [4]]) {
      assert.equal(SubtleCrypto.supports("generateKey", { ...base, publicExponent: new Uint8Array(exponent) }), false);
    }
    assert.equal(provider.queries.length, before);
    assert.equal(SubtleCrypto.supports("importKey", { name, hash: "SHA3-256" }), true);
    assert.equal(SubtleCrypto.supports("getPublicKey", name), true);
  }
  assert.equal(SubtleCrypto.supports("sign", { name: "RSA-PSS", saltLength: 0x7fff_ffff }), true);
  assert.equal(SubtleCrypto.supports("sign", { name: "RSA-PSS", saltLength: 0x8000_0000 }), false);
});

test("agreement queries inspect authentic peer metadata and never expose its handle", (t) => {
  const { provider } = fixture(t, true);
  for (const [curve, maximum] of [["P-256", 256], ["P-384", 384], ["P-521", 528]] as const) {
    const publicKey = agreementKey("ECDH", "public", curve);
    const parameters = { name: "ECDH", public: publicKey };
    assert.equal(SubtleCrypto.supports("deriveBits", parameters), true);
    assert.equal(SubtleCrypto.supports("deriveBits", parameters, maximum), true);
    assert.deepEqual(provider.queries.at(-1), { operation: "deriveBits", parameters: { kind: "ec", name: "ECDH", namedCurve: curve, hash: undefined }, length: maximum });
    assert.equal(SubtleCrypto.supports("deriveBits", parameters, maximum + 1), false);
  }
  assert.equal(SubtleCrypto.supports("deriveBits", { name: "ECDH", public: agreementKey("ECDH", "private") }, 128), false);
  assert.equal(SubtleCrypto.supports("deriveBits", { name: "ECDH", public: agreementKey("X25519") }, 128), false);
  for (const [name, maximum] of [["X25519", 256], ["X448", 448]] as const) {
    assert.equal(SubtleCrypto.supports("deriveBits", { name, public: agreementKey(name) }, maximum), true);
    assert.equal(SubtleCrypto.supports("deriveBits", { name, public: agreementKey(name) }, maximum + 1), false);
  }
});

test("HKDF, PBKDF2 and Argon2 checks validate lengths and known native limits without deriving", (t) => {
  fixture(t, true);
  assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), 255 * 256), true);
  assert.equal(SubtleCrypto.supports("deriveBits", hkdf(), 255 * 256 + 8), false);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...hkdf(), info: new Uint8Array(1024) }, 256), true);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...hkdf(), info: new Uint8Array(1025) }, 256), false);
  assert.equal(SubtleCrypto.supports("deriveBits", pbkdf2(), 0), true);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...pbkdf2(), iterations: 0 }, 0), false);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...pbkdf2(), iterations: 0x7fff_ffff }, 8), true);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...pbkdf2(), iterations: 0x8000_0000 }, 8), false);
  assert.equal(SubtleCrypto.supports("deriveBits", { ...pbkdf2(), iterations: 0x8000_0000 }, 0), true);
  for (const name of ["Argon2d", "Argon2i", "Argon2id"]) {
    assert.equal(SubtleCrypto.supports("importKey", name), true);
    for (const length of [32, 256, 0xffff_fff8]) assert.equal(SubtleCrypto.supports("deriveBits", argon2(name), length), true);
    for (const length of [null, 0, 24, 33]) assert.equal(SubtleCrypto.supports("deriveBits", argon2(name), length), false);
    for (const invalid of [{ version: 0 }, { passes: 0 }, { parallelism: 0 }, { parallelism: 0x100_0000 }, { memory: 7 }, { nonce: new Uint8Array(7) }]) {
      assert.equal(SubtleCrypto.supports("deriveBits", { ...argon2(name), ...invalid }, 256), false);
    }
  }
});

test("ML-DSA, ML-KEM and public-key derivation use only their registered operations", (t) => {
  fixture(t, true);
  for (const name of ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"]) {
    for (const operation of ["generateKey", "importKey", "exportKey", "sign", "verify", "getPublicKey"]) assert.equal(SubtleCrypto.supports(operation, name), true);
    for (const operation of ["encrypt", "deriveBits", "encapsulateBits", "decapsulateBits"]) assert.equal(SubtleCrypto.supports(operation, name), false);
    assert.equal(SubtleCrypto.supports("sign", { name, context: new Uint8Array(255) }), true);
    assert.equal(SubtleCrypto.supports("verify", { name, context: new Uint8Array(256) }), false);
  }
  for (const name of ["ML-KEM-512", "ML-KEM-768", "ML-KEM-1024"]) {
    for (const operation of ["generateKey", "importKey", "exportKey", "encapsulateBits", "decapsulateBits", "getPublicKey"]) assert.equal(SubtleCrypto.supports(operation, name), true);
    for (const operation of ["encrypt", "deriveBits", "sign", "verify"]) assert.equal(SubtleCrypto.supports(operation, name), false);
  }
  for (const name of ["ECDSA", "ECDH", "Ed25519", "Ed448", "X25519", "X448"]) assert.equal(SubtleCrypto.supports("getPublicKey", name), true);
  for (const name of ["AES-GCM", "HMAC", "KMAC128", "HKDF", "Argon2id", "SHA-256"]) assert.equal(SubtleCrypto.supports("getPublicKey", name), false);
});

test("ML-DSA support rejects the context bound before native availability", (t) => {
  const { provider } = fixture(t);
  const results: boolean[] = [];
  for (const name of ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"]) {
    for (const operation of ["sign", "verify"]) {
      results.push(SubtleCrypto.supports(operation, { name, context: new Uint8Array(256) }));
    }
  }
  assert.deepEqual(results, [false, false, false, false, false, false]);
  assert.equal(provider.queries.length, 0);
  for (const name of ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"]) {
    for (const operation of ["sign", "verify"]) {
      assert.equal(SubtleCrypto.supports(operation, { name, context: new Uint8Array(255) }), true);
    }
  }
  assert.equal(provider.queries.length, 6);
});

test("deriveKey follows target import, two key-length normalizations, then primary derivation", (t) => {
  const { provider } = fixture(t);
  const trace = provider.trace;
  const target = { get name() { trace.push("target.name"); return "AES-GCM"; }, get length() { trace.push("target.length"); return 256; } };
  const primary = { ...hkdf(), get name() { trace.push("primary.name"); return "HKDF"; } };
  assert.equal(SubtleCrypto.supports("deriveKey", primary, target), true);
  assert.deepEqual(trace, [
    "target.name", "target.name", "native:importKey:AES-GCM",
    "target.name", "target.name", "target.length",
    "target.name", "target.name", "target.length",
    "primary.name", "primary.name", "native:deriveBits:HKDF",
  ]);
  assert.equal(provider.queries.at(-1)?.length, 256);
});

test("native-false additional algorithms short-circuit before any primary getter", (t) => {
  const { provider } = fixture(t);
  const primary = { get name(): never { throw new Error("primary must remain unread"); } };
  for (const operation of ["deriveKey", "wrapKey", "unwrapKey"]) {
    provider.results.push(false);
    assert.equal(SubtleCrypto.supports(operation, primary, "AES-GCM"), false);
  }
  assert.deepEqual(provider.trace, ["native:importKey:AES-GCM", "native:exportKey:AES-GCM", "native:importKey:AES-GCM"]);
});

test("deriveKey turns support-check errors into false but propagates final normalization errors", (t) => {
  const { provider } = fixture(t);
  const sentinel = new Error("final length normalization");
  let lengthReads = 0;
  const target = { name: "AES-GCM", get length() { if (++lengthReads === 2) throw sentinel; return 256; } };
  assert.throws(() => SubtleCrypto.supports("deriveKey", hkdf(), target), error => error === sentinel);
  assert.equal(provider.queries.length, 1);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), { name: "AES-GCM", get length(): never { throw sentinel; } }), false);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), { name: "AES-GCM", length: 100 }), false);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), { name: "HMAC", hash: "SHA-256", length: 0 }), false);
});

test("deriveKey composes real target lengths rather than guessing from algorithm names", (t) => {
  fixture(t, true);
  const primary = { name: "X25519", public: agreementKey("X25519") };
  assert.equal(SubtleCrypto.supports("deriveKey", primary, { name: "AES-GCM", length: 256 }), true);
  assert.equal(SubtleCrypto.supports("deriveKey", primary, { name: "HMAC", hash: "SHA-256" }), false);
  assert.equal(SubtleCrypto.supports("deriveKey", primary, { name: "HMAC", hash: "SHA-256", length: 256 }), true);
  assert.equal(SubtleCrypto.supports("deriveKey", primary, "Argon2id"), true);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), { name: "KMAC128", length: 0 }), true);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), "ChaCha20-Poly1305"), true);
  assert.equal(SubtleCrypto.supports("deriveKey", hkdf(), { name: "HMAC", hash: "SHA3-256" }), false);
});

test("wrap and unwrap retry normalization on the original dictionary after every failure", (t) => {
  const { provider } = fixture(t);
  for (const operation of ["wrapKey", "unwrapKey"]) {
    let reads = 0;
    const algorithm = { get name() { if (++reads === 1) throw new Error("retry normalization"); return "AES-GCM"; }, iv: new Uint8Array(12) };
    assert.equal(SubtleCrypto.supports(operation, algorithm, "AES-GCM"), true);
    assert.equal(reads, 3);
  }
  assert.deepEqual(provider.queries.map(query => query.operation), ["exportKey", "encrypt", "importKey", "decrypt"]);
});

test("KEM support composes shared length, target import feasibility and the encapsulation operation", (t) => {
  const { provider } = fixture(t, true);
  for (const operation of ["encapsulateKey", "decapsulateKey"]) {
    for (const target of ["AES-GCM", { name: "AES-GCM", length: 128 }, "ChaCha20-Poly1305", "HKDF", "PBKDF2", "Argon2id",
      { name: "HMAC", hash: "SHA-256" }, { name: "HMAC", hash: "SHA-256", length: 249 },
      { name: "KMAC128", length: 256 }, "KMAC256"]) {
      assert.equal(SubtleCrypto.supports(operation, "ML-KEM-768", target), true);
    }
    for (const target of ["RSA-PSS", "Ed25519", "ML-DSA-44", "SHA-256",
      { name: "HMAC", hash: "SHA-256", length: 248 }, { name: "HMAC", hash: "SHA-256", length: 257 },
      { name: "KMAC128", length: 128 }, { name: "KMAC128", length: 0 }]) {
      assert.equal(SubtleCrypto.supports(operation, "ML-KEM-768", target), false);
    }
  }
  const before = provider.queries.length;
  assert.equal(SubtleCrypto.supports("encapsulateKey", "SHA-256", { get name(): never { throw new Error("invalid KEM stops before target"); } }), false);
  assert.equal(provider.queries.length, before);
});

test("KEM target native failure stops before primary encapsulation normalization", (t) => {
  const { provider } = fixture(t);
  provider.results.push(false);
  let primaryReads = 0;
  const primary = { get name() { primaryReads++; return "ML-KEM-768"; } };
  assert.equal(SubtleCrypto.supports("encapsulateKey", primary, "AES-GCM"), false);
  assert.equal(primaryReads, 2, "only get-shared-key-length normalized the primary");
  assert.deepEqual(provider.trace, ["native:importKey:AES-GCM"]);
});

test("nonextractability and empty unknown usages do not trigger actual key construction", (t) => {
  const { provider } = fixture(t, true);
  for (const name of ["HMAC", "AES-GCM", "Argon2id", "ML-DSA-44", "ML-KEM-768"]) {
    const algorithm = name === "HMAC" ? { name, hash: "SHA-256" } : name;
    assert.equal(SubtleCrypto.supports("importKey", algorithm), true);
  }
  assert.equal(SubtleCrypto.supports("generateKey", { name: "AES-GCM", length: 256 }), true);
  assert.equal(provider.primitiveCalls, 0);
});

test("the native worker handles metadata and real operation replies on the same channel", () => {
  const provider = new NodeCryptoProvider();
  const query: CryptoSupportQuery = { operation: "digest", length: null, parameters: {
    kind: "cshake", name: "cSHAKE128", outputBits: 256, functionNameBytes: 0, customizationBytes: 15,
  } };
  const parameters = { name: "cSHAKE128" as const, outputLength: 256, functionName: new Uint8Array(),
    customization: new Uint8Array(Buffer.from("Email Signature")) };
  const expected = new Uint8Array(Buffer.from("c1c36925b6409a04f1b504fcbca9d82b4017277cb5ed2b2065fc1d3814d5aaf5", "hex"));
  // This explicit NIST SP 800-185 control is outside supports(). It makes the
  // worker protocol change observable without allowing supports to do a probe.
  for (let index = 0; index < 2; index++) {
    assert.equal(provider.supports(query), true);
    const result = provider.digestXof(parameters, new Uint8Array([0, 1, 2, 3]));
    assert.deepEqual(result, expected);
  }
});
