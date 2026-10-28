// Specification-derived tests, not copies of WPT. Web Cryptography Level 2:
// https://w3c.github.io/webcrypto/ §§10, 14.3.5, 18.4.4 and 32.
// Web IDL buffer conversions: https://webidl.spec.whatwg.org/#es-buffer-source-types
// and https://webidl.spec.whatwg.org/#get-buffer-source-copy.
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Crypto } from "../src/crypto/crypto.ts";
import { DOMException } from "../src/core/errors.ts";
import type { CryptoDigestName, CryptoDigestProvider, CryptoFailure } from "../src/provider/crypto.ts";
import type { RandomSource } from "../src/provider/primitives.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class CountingRandom implements RandomSource {
  readonly fills: Uint8Array[] = [];
  next: number = 0;

  fill(bytes: Uint8Array): void {
    this.fills.push(bytes);
    for (let index = 0; index < bytes.byteLength; index++) {
      bytes[index] = this.next++ & 255;
    }
  }
}

class RecordingDigestProvider extends NodeCryptoProvider {
  calls: number = 0;
  algorithm: CryptoDigestName | undefined;
  bytes: Uint8Array | undefined;

  override digest(algorithm: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    this.calls++;
    this.algorithm = algorithm;
    // A spy observes the borrowed view only to assert the no-copy boundary.
    this.bytes = bytes;
    return super.digest(algorithm, bytes);
  }
}

function fixture(provider: CryptoDigestProvider = new NodeCryptoProvider()): {
  crypto: Crypto;
  random: CountingRandom;
  scheduler: VirtualScheduler;
} {
  const random = new CountingRandom();
  const scheduler = new VirtualScheduler();
  return { crypto: new Crypto(random, provider, scheduler), random, scheduler };
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) result[index] = text.charCodeAt(index);
  return result;
}

function hex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("hex");
}

function domError(name: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof DOMException && error.name === name;
}

test("digest's byte access survives changes to buffer globals during normalization", async () => {
  const { crypto, scheduler } = fixture();
  const bytes = ascii("abc");
  const originalIsView = ArrayBuffer.isView;
  const originalByteArray = Uint8Array;
  let promise: Promise<ArrayBuffer>;
  try {
    promise = crypto.subtle.digest({
      get name() {
        ArrayBuffer.isView = ((_value: unknown): _value is ArrayBufferView => false);
        globalThis.Uint8Array = function () {
          throw new Error("must not invoke a replacement constructor");
        } as unknown as Uint8ArrayConstructor;
        return "SHA-256";
      },
    }, new DataView(bytes.buffer));
  } finally {
    ArrayBuffer.isView = originalIsView;
    globalThis.Uint8Array = originalByteArray;
  }
  scheduler.runPending();
  assert.equal(hex(await promise), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

const integerTypes: readonly {
  name: string;
  width: number;
  create: (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView;
}[] = [
  { name: "Int8Array", width: 1, create: (b, o, n) => new Int8Array(b, o, n) },
  { name: "Uint8Array", width: 1, create: (b, o, n) => new Uint8Array(b, o, n) },
  { name: "Uint8ClampedArray", width: 1, create: (b, o, n) => new Uint8ClampedArray(b, o, n) },
  { name: "Int16Array", width: 2, create: (b, o, n) => new Int16Array(b, o, n) },
  { name: "Uint16Array", width: 2, create: (b, o, n) => new Uint16Array(b, o, n) },
  { name: "Int32Array", width: 4, create: (b, o, n) => new Int32Array(b, o, n) },
  { name: "Uint32Array", width: 4, create: (b, o, n) => new Uint32Array(b, o, n) },
  { name: "BigInt64Array", width: 8, create: (b, o, n) => new BigInt64Array(b, o, n) },
  { name: "BigUint64Array", width: 8, create: (b, o, n) => new BigUint64Array(b, o, n) },
];

for (const type of integerTypes) {
  test(`getRandomValues fills ${type.name}'s exact memory range once and returns it`, () => {
    const { crypto, random } = fixture();
    const buffer = new ArrayBuffer(48);
    const allBytes = new Uint8Array(buffer);
    allBytes.fill(0xa5);
    const view = type.create(buffer, 8, 3);
    assert.equal(crypto.getRandomValues(view), view);
    assert.equal(random.fills.length, 1);
    const filled = random.fills[0]!;
    assert.equal(filled.buffer, buffer);
    assert.equal(filled.byteOffset, 8);
    assert.equal(filled.byteLength, type.width * 3);
    if (type.name === "Uint8Array") assert.equal(filled, view);
    for (let index = 0; index < allBytes.length; index++) {
      const expected = index >= 8 && index < 8 + type.width * 3 ? index - 8 : 0xa5;
      assert.equal(allBytes[index], expected, `byte ${index}`);
    }
  });

  test(`getRandomValues applies the 65,536-byte limit to ${type.name}`, () => {
    const { crypto, random } = fixture();
    const maximum = type.create(new ArrayBuffer(65_536), 0, 65_536 / type.width);
    assert.equal(crypto.getRandomValues(maximum), maximum);
    assert.equal(random.fills.length, 1);
    const tooLarge = type.create(
      new ArrayBuffer(65_536 + type.width),
      0,
      65_536 / type.width + 1,
    );
    assert.throws(() => crypto.getRandomValues(tooLarge), domError("QuotaExceededError"));
    assert.equal(random.fills.length, 1, "invalid input must not consume randomness");
    assert.ok(new Uint8Array(tooLarge.buffer).every((byte) => byte === 0));
  });
}

test("getRandomValues accepts a zero-length integer view in one fill call", () => {
  const { crypto, random } = fixture();
  const view = new Uint8Array(new ArrayBuffer(16), 12, 0);
  assert.equal(crypto.getRandomValues(view), view);
  assert.deepEqual(random.fills, [view]);
});

test("getRandomValues uses the view's length, not the backing allocation's length", () => {
  const { crypto, random } = fixture();
  const view = new Uint8Array(new ArrayBuffer(100_000), 20_000, 65_536);
  assert.equal(crypto.getRandomValues(view), view);
  assert.equal(random.fills.length, 1);
});

test("getRandomValues rejects floating views and DataView before the quota check", () => {
  const { crypto, random } = fixture();
  for (const view of [
    new Float32Array(1),
    new Float64Array(1),
    new DataView(new ArrayBuffer(1)),
    new Float64Array(9_000),
    new DataView(new ArrayBuffer(65_537)),
  ]) {
    assert.throws(() => crypto.getRandomValues(view), domError("TypeMismatchError"));
  }
  assert.equal(random.fills.length, 0);
});

test("getRandomValues rejects values that are not ArrayBufferViews with TypeError", () => {
  const { crypto, random } = fixture();
  const call = crypto.getRandomValues as (value?: unknown) => unknown;
  for (const value of [undefined, null, 1, "bytes", {}, [], new ArrayBuffer(4)]) {
    assert.throws(() => call.call(crypto, value), TypeError);
  }
  assert.throws(() => call.call(crypto), TypeError);
  assert.equal(random.fills.length, 0);
});

test("getRandomValues rejects shared and resizable views during Web IDL conversion", () => {
  const { crypto, random } = fixture();
  const shared = new SharedArrayBuffer(16);
  const resizable = new ArrayBuffer(16, { maxByteLength: 32 });
  for (const buffer of [shared, resizable]) {
    for (const view of [new Uint8Array(buffer), new Float32Array(buffer), new DataView(buffer)]) {
      assert.throws(() => crypto.getRandomValues(view), TypeError);
    }
  }
  assert.equal(random.fills.length, 0);
});

test("getRandomValues returns a detached fixed integer view without writing bytes", () => {
  const { crypto, random } = fixture();
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer);
  buffer.transfer();
  assert.equal(crypto.getRandomValues(view), view);
  assert.equal(random.fills.length, 1);
  assert.equal(random.fills[0]!.byteLength, 0);
  const dataBuffer = new ArrayBuffer(4);
  const dataView = new DataView(dataBuffer);
  dataBuffer.transfer();
  assert.throws(() => crypto.getRandomValues(dataView), domError("TypeMismatchError"));
});

test("getRandomValues accepts cross-realm typed arrays", { skip: "nts programs have one realm" }, () => {
  const { crypto, random } = fixture();
  const view: Uint16Array = runInNewContext("new Uint16Array(new ArrayBuffer(16), 4, 3)");
  assert.equal(crypto.getRandomValues(view), view);
  assert.equal(random.fills[0]!.buffer, view.buffer);
  assert.equal(random.fills[0]!.byteOffset, 4);
  assert.deepEqual([...new Uint8Array(view.buffer, 4, 6)], [0, 1, 2, 3, 4, 5]);
});

test("getRandomValues reads intrinsic typed-array slots, not overridden accessors", {
  skip: "redefining an intrinsic accessor is something nts programs cannot do",
}, () => {
  class TrickyBytes extends Uint8Array {
    override get buffer(): ArrayBuffer { throw new Error("buffer getter must not run"); }
    override get byteOffset(): number { throw new Error("offset getter must not run"); }
    override get byteLength(): number { throw new Error("length getter must not run"); }
    override get [Symbol.toStringTag](): "Uint8Array" { throw new Error("tag getter must not run"); }
  }
  const buffer = new ArrayBuffer(12);
  const view = new TrickyBytes(buffer, 3, 4);
  const random: RandomSource = {
    fill(bytes) {
      // This provider deliberately does not read the caller's shadowable properties.
      Uint8Array.prototype.fill.call(bytes, 0x42);
    },
  };
  const crypto = new Crypto(random, new NodeCryptoProvider(), new VirtualScheduler());
  assert.equal(crypto.getRandomValues(view), view);
  assert.deepEqual([...new Uint8Array(buffer)], [0, 0, 0, 0x42, 0x42, 0x42, 0x42, 0, 0, 0, 0, 0]);
});

test("getRandomValues does not trust a floating view's forged toStringTag", {
  skip: "redefining an intrinsic accessor is something nts programs cannot do",
}, () => {
  class DisguisedFloat extends Float32Array {
    override get [Symbol.toStringTag](): "Float32Array" {
      return "Uint8Array" as "Float32Array";
    }
  }
  const { crypto, random } = fixture();
  assert.throws(() => crypto.getRandomValues(new DisguisedFloat(2)), domError("TypeMismatchError"));
  assert.equal(random.fills.length, 0);
});

test("Crypto methods reject an invalid receiver before consuming randomness", () => {
  const { crypto, random } = fixture();
  const get = crypto.getRandomValues as (this: unknown, value: unknown) => unknown;
  const uuid = crypto.randomUUID as (this: unknown) => string;
  for (const receiver of [undefined, null, {}, Object.create(Crypto.prototype)]) {
    assert.throws(() => get.call(receiver, new Uint8Array(1)), TypeError);
    assert.throws(() => uuid.call(receiver), TypeError);
  }
  assert.equal(random.fills.length, 0);
});

test("Crypto.subtle is cached per Crypto instance", () => {
  const first = fixture().crypto;
  const second = fixture().crypto;
  assert.equal(first.subtle, first.subtle);
  assert.notEqual(first.subtle, second.subtle);
});

test("randomUUID formats version 4 and RFC variant bits with lowercase hex", () => {
  const { crypto, random } = fixture();
  assert.equal(random.fills.length, 0, "constructing Crypto must not draw random bytes");
  assert.equal(crypto.randomUUID(), "00010203-0405-4607-8809-0a0b0c0d0e0f");
  assert.equal(crypto.randomUUID(), "10111213-1415-4617-9819-1a1b1c1d1e1f");
  assert.equal(random.fills.length, 1);
  assert.equal(random.fills[0]!.byteLength, 2_048);
});

test("randomUUID consumes an entire 128-UUID pool before refilling it", () => {
  const { crypto, random } = fixture();
  for (let index = 0; index < 128; index++) {
    assert.match(crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.equal(random.fills.length, 1, "one native fill must serve 128 UUIDs");
  crypto.randomUUID();
  assert.equal(random.fills.length, 2);
  assert.equal(random.fills[0]!.buffer, random.fills[1]!.buffer, "reuse the allocated pool");
});

test("randomUUID overwrites the version and variant bits for all input bit patterns", () => {
  for (const byte of [0, 0x3f, 0x40, 0x7f, 0x80, 0xbf, 0xc0, 0xff]) {
    const random: RandomSource = { fill(bytes) { bytes.fill(byte); } };
    const crypto = new Crypto(random, new NodeCryptoProvider(), new VirtualScheduler());
    const uuid = crypto.randomUUID();
    assert.equal(uuid[14], "4");
    assert.equal(Number.parseInt(uuid[19]!, 16), ((byte & 0x3f) | 0x80) >> 4);
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test("randomUUID pools belong to their own Crypto and RandomSource", () => {
  const first = fixture();
  const second = fixture();
  second.random.next = 32;
  assert.equal(first.crypto.randomUUID(), "00010203-0405-4607-8809-0a0b0c0d0e0f");
  assert.equal(second.crypto.randomUUID(), "20212223-2425-4627-a829-2a2b2c2d2e2f");
  assert.equal(first.random.fills.length, 1);
  assert.equal(second.random.fills.length, 1);
});

test("getRandomValues uses fresh RandomSource bytes independently of the UUID pool", () => {
  const { crypto, random } = fixture();
  crypto.randomUUID();
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  assert.deepEqual([...bytes], [0, 1, 2, 3]);
  assert.equal(random.fills.length, 2);
  assert.equal(random.fills[1], bytes);
  assert.equal(crypto.randomUUID(), "10111213-1415-4617-9819-1a1b1c1d1e1f");
  assert.equal(random.fills.length, 2);
});

// Fixed answers keep a broken algorithm/dispatch from agreeing with its own oracle.
// The abc and million-a vectors are the FIPS 180-2 Appendix A-D examples:
// https://csrc.nist.gov/files/pubs/fips/180-2/upd1/final/docs/fips180-2withchangenotice.pdf
const vectors: readonly {
  name: CryptoDigestName;
  empty: string;
  abc: string;
  million: string;
}[] = [
  {
    name: "SHA-1",
    empty: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    abc: "a9993e364706816aba3e25717850c26c9cd0d89d",
    million: "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
  },
  {
    name: "SHA-256",
    empty: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    million: "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
  },
  {
    name: "SHA-384",
    empty: "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    abc: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    million: "9d0e1809716474cb086e834e310a4a1ced149e9c00f248527972cec5704c2a5b07b8b3dc38ecc4ebae97ddd87f3d8985",
  },
  {
    name: "SHA-512",
    empty: "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    abc: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    million: "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
  },
];

for (const vector of vectors) {
  for (const sample of ["empty", "abc", "million"] as const) {
    test(`digest ${vector.name} matches the ${sample} known answer`, async () => {
      const provider = new RecordingDigestProvider();
      const { crypto, scheduler, random } = fixture(provider);
      const bytes = sample === "million" ? new Uint8Array(1_000_000).fill(0x61) : ascii(sample === "empty" ? "" : "abc");
      const pending = crypto.subtle.digest(vector.name, bytes);
      assert.equal(provider.calls, 1);
      assert.equal(provider.algorithm, vector.name);
      assert.equal(provider.bytes!.buffer, bytes.buffer);
      assert.equal(random.fills.length, 0);
      scheduler.runPending();
      const result = await pending;
      assert.ok(result instanceof ArrayBuffer);
      assert.equal(hex(result), vector[sample]);
    });
  }

  test(`digest ${vector.name} normalizes mixed ASCII case for strings and dictionaries`, async () => {
    const { crypto, scheduler } = fixture();
    for (const algorithm of [vector.name.toLowerCase(), { name: vector.name.toLowerCase() }]) {
      const pending = crypto.subtle.digest(algorithm, ascii("abc"));
      scheduler.runPending();
      assert.equal(hex(await pending), vector.abc);
    }
  });
}

test("digest accepts every BufferSource view and only hashes its memory range", async () => {
  const cases: Array<(buffer: ArrayBuffer) => ArrayBufferView> = [
    ...integerTypes.map((type) => (buffer: ArrayBuffer) => type.create(buffer, 8, 8 / type.width)),
    (buffer) => new Float32Array(buffer, 8, 2),
    (buffer) => new Float64Array(buffer, 8, 1),
    (buffer) => new DataView(buffer, 8, 8),
  ];
  const expected = new NodeCryptoProvider().digest("SHA-256", ascii("abcdefgh"));
  for (const create of cases) {
    const { crypto, scheduler } = fixture();
    const bytes = ascii("padding!abcdefghunused!!");
    const pending = crypto.subtle.digest("SHA-256", create(bytes.buffer));
    scheduler.runPending();
    assert.deepEqual(new Uint8Array(await pending), expected);
  }
});

test("digest accepts a fixed ArrayBuffer without copying its bytes", async () => {
  const provider = new RecordingDigestProvider();
  const { crypto, scheduler } = fixture(provider);
  const buffer = ascii("abc").buffer;
  const pending = crypto.subtle.digest("SHA-256", buffer);
  assert.equal(provider.bytes!.buffer, buffer);
  scheduler.runPending();
  assert.equal(hex(await pending), vectors[1]!.abc);
});

test("digest consumes bytes synchronously but settles from the scheduler task", async () => {
  const provider = new RecordingDigestProvider();
  const { crypto, scheduler } = fixture(provider);
  const bytes = ascii("abc");
  let settled = false;
  const pending = crypto.subtle.digest("SHA-256", bytes);
  void pending.then(() => { settled = true; });
  assert.equal(provider.calls, 1);
  assert.equal(provider.bytes!.buffer, bytes.buffer);
  assert.equal(scheduler.hasPending, true);
  bytes.fill(0);
  await Promise.resolve();
  assert.equal(settled, false, "a microtask alone must not settle the operation");
  scheduler.runPending();
  assert.equal(hex(await pending), vectors[1]!.abc);
  assert.equal(settled, true);
});

test("digest is unaffected by transferring its input after the call", async () => {
  const { crypto, scheduler } = fixture();
  const bytes = ascii("abc");
  const pending = crypto.subtle.digest("SHA-256", bytes);
  bytes.buffer.transfer();
  scheduler.runPending();
  assert.equal(hex(await pending), vectors[1]!.abc);
});

test("digest returns separate result buffers on successive operations", async () => {
  const { crypto, scheduler } = fixture();
  const first = crypto.subtle.digest("SHA-256", ascii("abc"));
  const second = crypto.subtle.digest("SHA-256", ascii("abc"));
  scheduler.runPending();
  const a = await first;
  const b = await second;
  assert.notEqual(a, b);
  new Uint8Array(a).fill(0);
  assert.equal(hex(b), vectors[1]!.abc);
});

test("the Node digest adapter returns a failure value for a native exception", () => {
  const provider = new NodeCryptoProvider();
  // Deliberately bypass the typed algorithm boundary to exercise createHash failure.
  const unavailable = "missing-native-digest" as CryptoDigestName;
  assert.deepEqual(provider.digest(unavailable, new Uint8Array()), { failure: "operation" });
});

test("digest maps returned primitive failures to OperationError on a scheduler task", async () => {
  for (const failure of ["operation", "invalid-key"] as const) {
    let calls = 0;
    const provider: CryptoDigestProvider = { digest() { calls++; return { failure }; } };
    const { crypto, scheduler } = fixture(provider);
    let rejected = false;
    const pending = crypto.subtle.digest("SHA-256", ascii("abc"));
    void pending.catch(() => { rejected = true; });
    assert.equal(calls, 1);
    await Promise.resolve();
    assert.equal(rejected, false);
    assert.equal(scheduler.hasPending, true);
    scheduler.runPending();
    await assert.rejects(pending, domError("OperationError"));
  }
});

test("digest invalid receivers and missing arguments return rejected promises", async () => {
  const { crypto, scheduler } = fixture();
  const digest = crypto.subtle.digest as (this: unknown, ...args: unknown[]) => Promise<ArrayBuffer>;
  const invalidCalls = [
    () => digest.call(crypto.subtle),
    () => digest.call(crypto.subtle, "SHA-256"),
    () => digest.call(undefined, "SHA-256", new Uint8Array()),
    () => digest.call({}, "SHA-256", new Uint8Array()),
    () => digest.call(Object.create(Object.getPrototypeOf(crypto.subtle)), "SHA-256", new Uint8Array()),
  ];
  for (const call of invalidCalls) {
    let result: Promise<ArrayBuffer> | undefined;
    assert.doesNotThrow(() => { result = call(); });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, TypeError);
  }
  assert.equal(scheduler.hasPending, false);
});

test("digest rejects invalid BufferSources before reading the algorithm dictionary", async () => {
  const provider = new RecordingDigestProvider();
  const { crypto, scheduler } = fixture(provider);
  let reads = 0;
  const algorithm = { get name(): string { reads++; return "unknown"; } };
  for (const data of [undefined, null, 1, "abc", [1, 2, 3], {}, new SharedArrayBuffer(4)]) {
    await assert.rejects(crypto.subtle.digest(algorithm, data), TypeError);
  }
  assert.equal(reads, 0);
  assert.equal(provider.calls, 0);
  assert.equal(scheduler.hasPending, false);
});

test("digest rejects resizable and shared data before algorithm normalization", async () => {
  const { crypto, scheduler } = fixture();
  const shared = new SharedArrayBuffer(16);
  const resizable = new ArrayBuffer(16, { maxByteLength: 32 });
  for (const buffer of [shared, resizable]) {
    for (const data of [buffer, new Uint8Array(buffer), new DataView(buffer)]) {
      await assert.rejects(crypto.subtle.digest("unknown", data), TypeError);
    }
  }
  assert.equal(scheduler.hasPending, false);
});

test("digest hashes detached fixed buffers and views as the empty sequence", async () => {
  const { crypto, scheduler } = fixture();
  const buffer = new ArrayBuffer(8);
  const typed = new Uint8Array(buffer, 2, 3);
  const view = new DataView(buffer, 1, 5);
  buffer.transfer();
  for (const data of [buffer, typed, view]) {
    const pending = crypto.subtle.digest("SHA-256", data);
    scheduler.runPending();
    assert.equal(hex(await pending), vectors[1]!.empty);
  }
});

test("digest handles algorithm getter mutation and detachment before reading bytes", async () => {
  const { crypto, scheduler } = fixture();
  const bytes = ascii("def");
  const mutation = {
    get name(): string {
      bytes.set(ascii("abc"));
      return "SHA-256";
    },
  };
  const first = crypto.subtle.digest(mutation, bytes);
  scheduler.runPending();
  assert.equal(hex(await first), vectors[1]!.abc);
  const buffer = new ArrayBuffer(8);
  const detachment = {
    get name(): string {
      if (!buffer.detached) buffer.transfer();
      return "SHA-256";
    },
  };
  const second = crypto.subtle.digest(detachment, new DataView(buffer));
  scheduler.runPending();
  assert.equal(hex(await second), vectors[1]!.empty);
});

test("digest accepts cross-realm ArrayBuffer and views", { skip: "nts programs have one realm" }, async () => {
  const { crypto, scheduler } = fixture();
  for (const expression of [
    "new Uint8Array([97, 98, 99]).buffer",
    "new Uint8Array([97, 98, 99])",
    "new DataView(new Uint8Array([97, 98, 99]).buffer)",
  ]) {
    const data: unknown = runInNewContext(expression);
    const pending = crypto.subtle.digest("SHA-256", data);
    scheduler.runPending();
    assert.equal(hex(await pending), vectors[1]!.abc);
  }
});

test("digest does not read overridden BufferSource accessors", {
  skip: "redefining an intrinsic accessor is something nts programs cannot do",
}, async () => {
  class TrickyView extends DataView<ArrayBuffer> {
    override get buffer(): ArrayBuffer { throw new Error("buffer getter must not run"); }
    override get byteOffset(): number { throw new Error("offset getter must not run"); }
    override get byteLength(): number { throw new Error("length getter must not run"); }
  }
  const { crypto, scheduler } = fixture();
  const pending = crypto.subtle.digest("SHA-256", new TrickyView(ascii("abc").buffer));
  scheduler.runPending();
  assert.equal(hex(await pending), vectors[1]!.abc);
});

test("digest normalizes a supported dictionary name twice and preserves the first match", async () => {
  const provider = new RecordingDigestProvider();
  const { crypto, scheduler } = fixture(provider);
  let reads = 0;
  const algorithm = { get name(): string { return ++reads === 1 ? "sha-256" : "SHA-512"; } };
  const pending = crypto.subtle.digest(algorithm, ascii("abc"));
  assert.equal(reads, 2);
  assert.equal(provider.algorithm, "SHA-256");
  scheduler.runPending();
  assert.equal(hex(await pending), vectors[1]!.abc);
});

test("digest preserves exceptions from either algorithm name conversion", async () => {
  const { crypto, scheduler } = fixture();
  for (const failedRead of [1, 2]) {
    const failure = new Error(`name conversion ${failedRead}`);
    let reads = 0;
    const algorithm = {
      get name(): string {
        if (++reads === failedRead) throw failure;
        return "SHA-256";
      },
    };
    await assert.rejects(crypto.subtle.digest(algorithm, ascii("abc")), (error) => error === failure);
    assert.equal(reads, failedRead);
  }
  assert.equal(scheduler.hasPending, false);
});

test("digest rejects an absent or invalid required dictionary name", async () => {
  const { crypto, scheduler } = fixture();
  for (const algorithm of [{}, { name: undefined }, { name: Symbol("name") }, new String("SHA-256")]) {
    await assert.rejects(crypto.subtle.digest(algorithm, ascii("abc")), TypeError);
  }
  let reads = 0;
  const losesName = { get name(): string | undefined { return ++reads === 1 ? "SHA-256" : undefined; } };
  await assert.rejects(crypto.subtle.digest(losesName, ascii("abc")), TypeError);
  assert.equal(reads, 2);
  assert.equal(scheduler.hasPending, false);
});

test("digest rejects unregistered names and wrong-operation algorithms before a second read", async () => {
  const provider = new RecordingDigestProvider();
  const { crypto, scheduler } = fixture(provider);
  for (const name of ["", "SHA256", " SHA-256", "SHA-256 ", "SHA-3-256", "AES-GCM", "HMAC", "ſha-256", "toString", "__proto__"]) {
    let reads = 0;
    const algorithm = { get name(): string { reads++; return name; } };
    await assert.rejects(crypto.subtle.digest(algorithm, ascii("abc")), domError("NotSupportedError"));
    assert.equal(reads, 1, name);
  }
  assert.equal(provider.calls, 0);
  assert.equal(scheduler.hasPending, false);
});

test("digest converts primitive AlgorithmIdentifiers to DOMString without boxing them", async () => {
  const { crypto, scheduler } = fixture();
  for (const algorithm of [undefined, null, 0, 1n, true]) {
    await assert.rejects(crypto.subtle.digest(algorithm, ascii("abc")), domError("NotSupportedError"));
  }
  await assert.rejects(crypto.subtle.digest(Symbol("SHA-256"), ascii("abc")), TypeError);
  assert.equal(scheduler.hasPending, false);
});

test("digest ignores additional dictionary members and accepts inherited names", async () => {
  const { crypto, scheduler } = fixture();
  const inherited: unknown = Object.create({ name: "SHA-256" });
  const extra = { name: "SHA-256", get unused(): never { throw new Error("unused member read"); } };
  for (const algorithm of [inherited, extra]) {
    const pending = crypto.subtle.digest(algorithm, ascii("abc"));
    scheduler.runPending();
    assert.equal(hex(await pending), vectors[1]!.abc);
  }
});
