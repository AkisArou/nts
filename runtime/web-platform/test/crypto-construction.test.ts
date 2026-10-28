// Web Cryptography §§10 and 14 declare interfaces without public constructors.
// https://w3c.github.io/webcrypto/#crypto-interface
// https://w3c.github.io/webcrypto/#subtlecrypto-interface
// These controls protect native capabilities and opaque CryptoKey handles at
// that boundary. Descriptor-only Web IDL checks remain out of scope.
import assert from "node:assert/strict";
import test from "node:test";
import { Crypto, createCrypto } from "../src/crypto/crypto.ts";
import { CryptoKey } from "../src/crypto/crypto-key.ts";
import { SubtleCrypto, createSubtleCrypto } from "../src/crypto/subtle-crypto.ts";
import type {
  CryptoDigestName, CryptoFailure, CryptoKeyHandle, CryptoKeyImport,
  CryptoKeyRecord, CryptoSignature, CryptoSignatureParameters,
} from "../src/provider/crypto.ts";
import type { RandomSource } from "../src/provider/primitives.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

// Deliberately allow the arguments JavaScript callers can supply, including the
// former provider-injection signatures and guessed internal construction tokens.
function withArguments<T>(constructor: new (...args: never) => T): new (...args: unknown[]) => T {
  return constructor as unknown as new (...args: unknown[]) => T;
}

function illegalConstructor(error: unknown): boolean {
  return error instanceof TypeError && error.message === "Illegal constructor";
}

class RecordingRandom implements RandomSource {
  fills = 0;
  fill(bytes: Uint8Array): void {
    this.fills++;
    bytes.fill(0x37);
  }
}

class RecordingScheduler extends VirtualScheduler {
  enqueues = 0;
  override enqueue(task: () => void): void {
    this.enqueues++;
    super.enqueue(task);
  }
}

class RecordingProvider extends NodeCryptoProvider {
  digests = 0;
  imports = 0;
  signs = 0;
  receivedHandle: CryptoKeyHandle | undefined;
  importedBytes: Uint8Array | undefined;

  override digest(name: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.digests++;
    return super.digest(name, bytes);
  }
  override importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    this.imports++;
    if (input.format === "raw") this.importedBytes = input.bytes;
    return super.importKey(input);
  }
  override sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, bytes: Uint8Array): CryptoSignature | CryptoFailure {
    this.signs++;
    this.receivedHandle = key;
    return super.sign(parameters, key, bytes);
  }
}

function fixture() {
  const random = new RecordingRandom();
  const provider = new RecordingProvider();
  const scheduler = new RecordingScheduler();
  const crypto = createCrypto(random, provider, scheduler);
  function settle<T>(promise: Promise<T>): Promise<T> { scheduler.runPending(); return promise; }
  return { crypto, random, provider, scheduler, settle };
}

test("Crypto has no public constructor, including through a subclass", () => {
  assert.equal(Crypto.length, 0);
  assert.throws(() => new Crypto(), illegalConstructor);
  class ForgedCrypto extends Crypto {}
  assert.throws(() => new ForgedCrypto(), illegalConstructor);
});

test("SubtleCrypto has no public constructor, including through a subclass", () => {
  assert.equal(SubtleCrypto.length, 0);
  assert.throws(() => new SubtleCrypto(), illegalConstructor);
  class ForgedSubtle extends SubtleCrypto {}
  assert.throws(() => new ForgedSubtle(), illegalConstructor);
});

for (const name of ["Crypto", "SubtleCrypto"] as const) {
  test(name + " rejects legacy arguments and guessed tokens without reading capabilities", () => {
    const reads: string[] = [];
    function unexpected(name: string): never {
      reads.push(name);
      throw new Error("An illegal constructor read " + name);
    }
    const token = {
      get [Symbol.toPrimitive](): never { return unexpected("token conversion"); },
      get constructor(): never { return unexpected("token constructor"); },
    };
    const random = { get fill(): never { return unexpected("random.fill"); } };
    const provider = {
      get digest(): never { return unexpected("provider.digest"); },
      get sign(): never { return unexpected("provider.sign"); },
      get importKey(): never { return unexpected("provider.importKey"); },
    };
    const scheduler = {
      get enqueue(): never { return unexpected("scheduler.enqueue"); },
      get delay(): never { return unexpected("scheduler.delay"); },
      get reportError(): never { return unexpected("scheduler.reportError"); },
    };
    const Constructor = name === "Crypto" ? withArguments(Crypto) : withArguments(SubtleCrypto);
    const capabilities = name === "Crypto" ? [random, provider, scheduler] : [provider, scheduler, random];
    assert.throws(() => new Constructor(...capabilities), illegalConstructor);
    for (const candidate of [undefined, null, token, name, Symbol(name + " construction"), Symbol.for(name + " construction")]) {
      assert.throws(() => new Constructor(candidate, ...capabilities), illegalConstructor);
    }
    assert.deepEqual(reads, []);
  });

  test(name + " reached through an instance still has no injectable constructor", () => {
    const f = fixture();
    const Constructor = name === "Crypto"
      ? withArguments(f.crypto.constructor as typeof Crypto)
      : withArguments(f.crypto.subtle.constructor as typeof SubtleCrypto);
    assert.equal(Constructor, name === "Crypto" ? Crypto : SubtleCrypto);
    const capabilities = name === "Crypto"
      ? [f.random, f.provider, f.scheduler]
      : [f.provider, f.scheduler, f.random];
    assert.throws(() => new Constructor(), illegalConstructor);
    assert.throws(() => new Constructor(...capabilities), illegalConstructor);
    assert.throws(() => new Constructor(Symbol(name + " construction"), ...capabilities), illegalConstructor);
    assert.equal(f.random.fills, 0);
    assert.equal(f.provider.digests, 0);
    assert.equal(f.provider.imports, 0);
    assert.equal(f.provider.signs, 0);
    assert.equal(f.scheduler.enqueues, 0);
  });
}

test("createCrypto binds canonical instances to its random source, provider and scheduler", async () => {
  const f = fixture();
  assert.ok(f.crypto instanceof Crypto);
  assert.ok(f.crypto.subtle instanceof SubtleCrypto);
  assert.equal(f.crypto.subtle, f.crypto.subtle);
  assert.notEqual(f.crypto.subtle, fixture().crypto.subtle);
  assert.equal(f.random.fills, 0);
  assert.equal(f.provider.digests, 0);
  assert.equal(f.scheduler.enqueues, 0);

  const bytes = new Uint8Array(4);
  assert.equal(f.crypto.getRandomValues(bytes), bytes);
  assert.deepEqual(bytes, new Uint8Array(4).fill(0x37));
  assert.equal(f.random.fills, 1);
  assert.equal(f.crypto.randomUUID(), "37373737-3737-4737-b737-373737373737");
  assert.equal(f.random.fills, 2);

  let settled = false;
  const pending = f.crypto.subtle.digest("SHA-256", new Uint8Array([0x61, 0x62, 0x63]));
  void pending.then(() => { settled = true; });
  assert.equal(f.provider.digests, 1, "the primitive is synchronous");
  assert.equal(f.scheduler.enqueues, 1);
  await Promise.resolve();
  assert.equal(settled, false, "settlement waits for the supplied scheduler");
  assert.equal(Buffer.from(await f.settle(pending)).toString("hex"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(settled, true);
});

test("createSubtleCrypto binds secret generation and signing to its own capabilities", async () => {
  const random = new RecordingRandom();
  const provider = new RecordingProvider();
  const scheduler = new RecordingScheduler();
  const subtle = createSubtleCrypto(provider, scheduler, random);
  assert.ok(subtle instanceof SubtleCrypto);
  assert.equal(subtle.constructor, SubtleCrypto);
  assert.equal(random.fills, 0);
  assert.equal(provider.imports, 0);
  assert.equal(scheduler.enqueues, 0);
  const pending = subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 32 }, false, ["sign"]);
  assert.equal(random.fills, 1);
  assert.equal(provider.imports, 1);
  assert.deepEqual(provider.importedBytes, new Uint8Array(4).fill(0x37));
  scheduler.runPending();
  const key = await pending;
  assert.ok(key instanceof CryptoKey);
  assert.equal(key.extractable, false);
  const signature = subtle.sign("HMAC", key, new Uint8Array([9]));
  assert.equal(provider.signs, 1);
  assert.notEqual(provider.receivedHandle, undefined);
  assert.equal(scheduler.enqueues, 2);
  scheduler.runPending();
  assert.equal((await signature).byteLength, 32);
});

test("a caller-selected constructor cannot deliver a nonextractable key handle to a spy", async () => {
  const f = fixture();
  const key = await f.settle(f.crypto.subtle.importKey("raw", new Uint8Array([1, 2, 3, 4]), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]));
  assert.equal(key.extractable, false);
  const spy = new RecordingProvider();
  const random = new RecordingRandom();
  const scheduler = new RecordingScheduler();
  const PublicCrypto = withArguments(Crypto);
  const PublicSubtle = withArguments(SubtleCrypto);
  const InstanceCrypto = withArguments(f.crypto.constructor as typeof Crypto);
  const InstanceSubtle = withArguments(f.crypto.subtle.constructor as typeof SubtleCrypto);
  const attempts: readonly (() => SubtleCrypto)[] = [
    () => new PublicCrypto(random, spy, scheduler).subtle,
    () => new InstanceCrypto(random, spy, scheduler).subtle,
    () => new PublicSubtle(spy, scheduler, random),
    () => new InstanceSubtle(spy, scheduler, random),
    () => new PublicCrypto(Symbol("Crypto construction"), random, spy, scheduler).subtle,
    () => new InstanceCrypto(Symbol("Crypto construction"), random, spy, scheduler).subtle,
    () => new PublicSubtle(Symbol("SubtleCrypto construction"), spy, scheduler, random),
    () => new InstanceSubtle(Symbol("SubtleCrypto construction"), spy, scheduler, random),
  ];
  for (const attempt of attempts) {
    assert.throws(() => { void attempt().sign("HMAC", key, new Uint8Array([9])); }, illegalConstructor);
  }
  assert.equal(spy.receivedHandle, undefined);
  assert.equal(spy.signs, 0);
  assert.equal(scheduler.enqueues, 0);
  assert.equal(random.fills, 0);
  const signature = await f.settle(f.crypto.subtle.sign("HMAC", key, new Uint8Array([9])));
  assert.equal(signature.byteLength, 32, "the legitimate owner remains usable");
  assert.equal(f.provider.signs, 1);
});

test("borrowed branded methods reject forged receivers before argument or provider access", async () => {
  const f = fixture();
  const reads: string[] = [];
  const algorithm = { get name(): never { reads.push("algorithm.name"); throw new Error("must not read"); } };
  assert.throws(() => Crypto.prototype.subtle, TypeError);
  for (const receiver of [undefined, null, {}, Crypto.prototype, SubtleCrypto.prototype]) {
    assert.throws(() => Crypto.prototype.getRandomValues.call(receiver, new Uint8Array(1)), TypeError);
    assert.throws(() => Crypto.prototype.randomUUID.call(receiver), TypeError);
    await assert.rejects(SubtleCrypto.prototype.digest.call(receiver, algorithm, new Uint8Array()), TypeError);
    await assert.rejects(SubtleCrypto.prototype.sign.call(receiver, algorithm, {}, new Uint8Array()), TypeError);
  }
  assert.deepEqual(reads, []);
  assert.equal(f.random.fills, 0);
  assert.equal(f.provider.digests, 0);
  assert.equal(f.provider.signs, 0);
  assert.equal(f.scheduler.enqueues, 0);
});
