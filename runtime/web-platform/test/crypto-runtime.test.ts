// Runtime capability assembly over the already tested Web Cryptography surface.
// No network, WPT scaffolding, descriptor checks or host Web Crypto oracle.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import * as PublicAPI from "../src/index.ts";
import type { AlgorithmIdentifier, JsonWebKey, KeyAlgorithm, KeyUsage } from "../src/index.ts";
import * as ProviderAPI from "../src/provider.ts";
import {
  currentWebPlatformRuntime, installWebPlatformRuntime, VirtualScheduler, WebPlatformRuntime,
} from "../src/provider.ts";
import type {
  CryptoDigestName, CryptoFailure, CryptoKeyImport, CryptoKeyRecord, CryptoProvider, RandomSource, WebPlatformOptions,
} from "../src/provider.ts";
import { hasWebPlatformRuntime } from "../src/provider/environment.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class CountingRandom implements RandomSource {
  readonly fills: Uint8Array[] = [];
  readonly value: number;

  constructor(value = 0x41) { this.value = value; }

  fill(bytes: Uint8Array): void {
    this.fills.push(bytes);
    bytes.fill(this.value);
  }
}

class CountingCryptoProvider extends NodeCryptoProvider {
  readonly digests: { algorithm: CryptoDigestName; bytes: Uint8Array }[] = [];
  readonly imports: CryptoKeyImport[] = [];
  failDigest = false;

  override digest(algorithm: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.digests.push({ algorithm, bytes });
    return this.failDigest ? { failure: "operation" } : super.digest(algorithm, bytes);
  }

  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports.push(input);
    return super.importKey(input);
  }
}

function fixture(provider = new CountingCryptoProvider(), random = new CountingRandom()): {
  runtime: WebPlatformRuntime;
  provider: CountingCryptoProvider;
  random: CountingRandom;
  scheduler: VirtualScheduler;
  options: WebPlatformOptions;
} {
  const scheduler = new VirtualScheduler();
  const primitives = { ...createHostNodePrimitives(), random, scheduler };
  const options: WebPlatformOptions = { crypto: provider };
  return { runtime: new WebPlatformRuntime(primitives, options), provider, random, scheduler, options };
}

function runtimeCrypto(runtime: WebPlatformRuntime): PublicAPI.Crypto {
  const crypto = runtime.crypto;
  assert.ok(crypto instanceof PublicAPI.Crypto);
  return crypto;
}

test("a runtime without a crypto capability stays absent despite ambient Node crypto", () => {
  assert.equal(typeof globalThis.crypto.getRandomValues, "function");
  const random = new CountingRandom();
  const scheduler = new VirtualScheduler();
  const primitives = { ...createHostNodePrimitives(), random, scheduler };
  const absent = new WebPlatformRuntime(primitives);
  const explicit = new WebPlatformRuntime(primitives, { crypto: undefined });
  try {
    assert.equal(absent.crypto, undefined);
    assert.equal(explicit.crypto, undefined);
    assert.equal(random.fills.length, 0);
    assert.equal(scheduler.hasPending, false);
  } finally {
    absent.close(); explicit.close();
  }
});

test("runtime construction reads crypto once and creates stable canonical objects without entropy", () => {
  const provider = new CountingCryptoProvider();
  const random = new CountingRandom();
  const scheduler = new VirtualScheduler();
  let reads = 0;
  const options: WebPlatformOptions = {
    get crypto(): CryptoProvider {
      reads++;
      if (reads !== 1) throw new Error("The capability must be read once");
      return provider;
    },
  };
  const runtime = new WebPlatformRuntime({ ...createHostNodePrimitives(), random, scheduler }, options);
  try {
    const crypto = runtimeCrypto(runtime);
    assert.equal(runtime.crypto, crypto);
    assert.equal(crypto.constructor, PublicAPI.Crypto);
    assert.ok(crypto.subtle instanceof PublicAPI.SubtleCrypto);
    assert.equal(crypto.subtle.constructor, PublicAPI.SubtleCrypto);
    assert.equal(crypto.subtle, crypto.subtle);
    assert.equal(reads, 1);
    assert.equal(random.fills.length, 0);
    assert.equal(provider.digests.length, 0);
    assert.equal(provider.imports.length, 0);
    assert.equal(scheduler.hasPending, false);
  } finally { runtime.close(); }
});

test("runtime crypto routes exact random views and secret generation to its random source", async () => {
  const { runtime, provider, random, scheduler } = fixture();
  try {
    const crypto = runtimeCrypto(runtime);
    const backing = new Uint8Array(12).fill(0xa5);
    const view = backing.subarray(3, 7);
    assert.equal(crypto.getRandomValues(view), view);
    assert.equal(random.fills.length, 1);
    assert.equal(random.fills[0], view);
    assert.deepEqual(backing, new Uint8Array([0xa5, 0xa5, 0xa5, 0x41, 0x41, 0x41, 0x41, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5]));

    const pending = crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt"]);
    assert.equal(random.fills.length, 2);
    assert.equal(random.fills[1]!.byteLength, 16);
    assert.equal(provider.imports.length, 1);
    const input = provider.imports[0]!;
    assert.ok(input.format === "raw" && input.family === "secret");
    assert.deepEqual(input.bytes, new Uint8Array(16).fill(random.value));
    assert.equal(scheduler.hasPending, true);
    scheduler.runPending();
    assert.ok(await pending instanceof PublicAPI.CryptoKey);
  } finally { runtime.close(); }
});

test("runtime subtle crypto routes native work and deferred success/failure to its scheduler", async () => {
  const { runtime, provider, scheduler } = fixture();
  try {
    const crypto = runtimeCrypto(runtime);
    const bytes = new Uint8Array([1, 2, 3]);
    let settled = false;
    const pending = crypto.subtle.digest("SHA-256", bytes);
    void pending.then(() => { settled = true; });
    assert.equal(provider.digests.length, 1);
    assert.equal(provider.digests[0]!.algorithm, "SHA-256");
    assert.deepEqual(provider.digests[0]!.bytes, bytes);
    assert.equal(scheduler.hasPending, true);
    await Promise.resolve();
    assert.equal(settled, false);
    scheduler.runPending();
    assert.equal((await pending).byteLength, 32);
    assert.equal(settled, true);
    assert.equal(scheduler.hasPending, false);

    provider.failDigest = true;
    const rejected = assert.rejects(crypto.subtle.digest("SHA-256", bytes),
      (error: unknown) => error instanceof PublicAPI.DOMException && error.name === "OperationError");
    assert.equal(provider.digests.length, 2);
    assert.equal(scheduler.hasPending, true);
    scheduler.runPending();
    await rejected;
    assert.deepEqual(scheduler.errors, []);
  } finally { runtime.close(); }
});

test("runtime replacement and later option mutation cannot retarget existing crypto objects", async () => {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const first = fixture(new CountingCryptoProvider(), new CountingRandom(0x11));
  const second = fixture(new CountingCryptoProvider(), new CountingRandom(0x22));
  try {
    const original = runtimeCrypto(first.runtime);
    const replacement = runtimeCrypto(second.runtime);
    assert.notEqual(original, replacement);
    assert.notEqual(original.subtle, replacement.subtle);
    first.options.crypto = second.provider;
    installWebPlatformRuntime(first.runtime);
    installWebPlatformRuntime(second.runtime);
    assert.equal(currentWebPlatformRuntime(), second.runtime);
    assert.equal(first.runtime.crypto, original);
    assert.deepEqual(original.getRandomValues(new Uint8Array(1)), new Uint8Array([0x11]));
    assert.deepEqual(replacement.getRandomValues(new Uint8Array(1)), new Uint8Array([0x22]));

    let firstSettled = false;
    const pendingFirst = original.subtle.digest("SHA-256", new Uint8Array([1]));
    void pendingFirst.then(() => { firstSettled = true; });
    const pendingSecond = replacement.subtle.digest("SHA-256", new Uint8Array([2]));
    assert.equal(first.provider.digests.length, 1);
    assert.equal(second.provider.digests.length, 1);
    assert.deepEqual(first.provider.digests[0]!.bytes, new Uint8Array([1]));
    assert.deepEqual(second.provider.digests[0]!.bytes, new Uint8Array([2]));
    second.scheduler.runPending();
    await pendingSecond;
    assert.equal(firstSettled, false);
    first.scheduler.runPending();
    await pendingFirst;
    assert.equal(firstSettled, true);
  } finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    first.runtime.close(); second.runtime.close();
  }
});

test("public crypto exports preserve canonical keys and exclude native construction and slots", async () => {
  const { runtime, scheduler } = fixture();
  try {
    for (const name of ["createCrypto", "createSubtleCrypto", "createCryptoKey", "getCryptoKeySlots", "CryptoKeySlots", "CryptoKeyHandle", "CryptoProvider", "CryptoFailure"]) {
      assert.equal(name in PublicAPI, false, name);
      assert.equal(name in ProviderAPI, false, name);
    }
    for (const name of ["Crypto", "SubtleCrypto", "CryptoKey"]) assert.equal(name in ProviderAPI, false, name);
    for (const name of ["KeyAlgorithm", "JsonWebKey", "RsaOtherPrimesInfo"]) assert.equal(name in PublicAPI, false, name);

    const crypto = runtimeCrypto(runtime);
    const data: JsonWebKey = { kty: "oct", k: "AQIDBA", alg: "HS256" };
    const algorithm: AlgorithmIdentifier = { name: "HMAC", hash: "SHA-256" };
    const usages: KeyUsage[] = ["sign"];
    const pending = crypto.subtle.importKey("jwk", data, algorithm, false, usages);
    scheduler.runPending();
    const key = await pending;
    assert.ok(key instanceof PublicAPI.CryptoKey);
    assert.equal(key.constructor, PublicAPI.CryptoKey);
    const metadata: KeyAlgorithm = key.algorithm;
    assert.equal(metadata.name, "HMAC");
    assert.deepEqual(key.usages, usages);
    for (const value of [crypto, crypto.subtle, key]) {
      for (const name of ["provider", "random", "scheduler", "handle", "slots", "getCryptoKeySlots"]) assert.equal(name in value, false, name);
    }
  } finally { runtime.close(); }
});

test("public and instance constructors cannot inject replacement crypto capabilities", () => {
  const { runtime, random } = fixture();
  try {
    const crypto = runtimeCrypto(runtime);
    const spyProvider = new CountingCryptoProvider();
    const spyRandom = new CountingRandom();
    const spyScheduler = new VirtualScheduler();
    const guessedToken = Symbol("not the internal token");
    for (const Constructor of [PublicAPI.Crypto, crypto.constructor as typeof PublicAPI.Crypto]) {
      assert.throws(() => new Constructor(), TypeError);
      assert.throws(() => new Constructor(guessedToken, spyRandom, spyProvider, spyScheduler), TypeError);
    }
    for (const Constructor of [PublicAPI.SubtleCrypto, crypto.subtle.constructor as typeof PublicAPI.SubtleCrypto]) {
      assert.throws(() => new Constructor(), TypeError);
      assert.throws(() => new Constructor(guessedToken, spyProvider, spyScheduler, spyRandom), TypeError);
    }
    assert.throws(() => new PublicAPI.CryptoKey(), TypeError);
    assert.throws(() => new PublicAPI.CryptoKey(guessedToken), TypeError);
    crypto.getRandomValues(new Uint8Array(1));
    assert.equal(random.fills.length, 1);
    assert.equal(spyRandom.fills.length, 0);
    assert.equal(spyProvider.digests.length, 0);
    assert.equal(spyProvider.imports.length, 0);
    assert.equal(spyScheduler.hasPending, false);
  } finally { runtime.close(); }
});

test("the Node host helper forwards the optional crypto capability without supplying a default", async () => {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const provider = new CountingCryptoProvider();
  const absent = createHostNodeWebPlatform();
  const enabled = createHostNodeWebPlatform({ crypto: provider });
  try {
    assert.equal(absent.crypto, undefined);
    const crypto = runtimeCrypto(enabled);
    assert.equal(enabled.crypto, crypto);
    assert.equal(currentWebPlatformRuntime(), enabled);
    await crypto.subtle.digest("SHA-256", new Uint8Array([1]));
    assert.equal(provider.digests.length, 1);
  } finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    absent.close(); enabled.close();
  }
});
