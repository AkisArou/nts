// Web Cryptography §10.1.1 step 3 and Web IDL §§2.8.3, 3.2.7, 3.2.10, 3.2.17.
// https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues
// https://webidl.spec.whatwg.org/#idl-QuotaExceededError
import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { QuotaExceededError } from "../src/core/quota-exceeded-error.ts";
import { createCrypto } from "../src/crypto/crypto.ts";
import type { RandomSource } from "../src/provider/primitives.ts";
import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import { NodeCryptoProvider } from "./node-crypto-provider.ts";

class CountingRandom implements RandomSource {
  readonly fills: Uint8Array[] = [];

  fill(bytes: Uint8Array): void {
    this.fills.push(bytes);
    bytes.fill(0xa5);
  }
}

function fixture(): { crypto: ReturnType<typeof createCrypto>; random: CountingRandom } {
  const random = new CountingRandom();
  return { crypto: createCrypto(random, new NodeCryptoProvider(), new VirtualScheduler()), random };
}

test("QuotaExceededError constructor defaults preserve canonical error identity", () => {
  const error = new QuotaExceededError();
  assert.ok(error instanceof QuotaExceededError);
  assert.ok(error instanceof DOMException);
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, QuotaExceededError);
  assert.equal(error.name, "QuotaExceededError");
  assert.equal(error.message, "");
  assert.equal(error.code, 22);
  assert.equal(error.quota, null);
  assert.equal(error.requested, null);
  assert.equal(error[Symbol.toStringTag], "QuotaExceededError");
  assert.equal(Object.prototype.toString.call(error), "[object QuotaExceededError]");
  assert.equal(error.toString(), "QuotaExceededError");
});

test("QuotaExceededError constructor applies DOMString conversion to its message", () => {
  for (const [message, expected] of [
    [undefined, ""], [null, "null"], [false, "false"], [42, "42"], [42n, "42"],
    ["\ud800", "\ud800"], [{ toString: () => "converted" }, "converted"],
  ] as const) assert.equal(new QuotaExceededError(message).message, expected);
  assert.throws(() => new QuotaExceededError(Symbol("message")), TypeError);
});

test("QuotaExceededError constructor treats absent and null dictionaries as empty", () => {
  for (const options of [undefined, null, {}, [], { quota: undefined, requested: undefined }]) {
    const error = new QuotaExceededError("", options);
    assert.equal(error.quota, null);
    assert.equal(error.requested, null);
  }
  for (const options of [0, "", false, 0n, Symbol("options")]) {
    assert.throws(() => new QuotaExceededError("", options), TypeError);
  }
});

test("QuotaExceededError constructor converts present finite doubles without rounding", () => {
  const values = [
    [null, 0], [false, 0], [true, 1], ["1.25", 1.25], [Number.MIN_VALUE, Number.MIN_VALUE],
    [Number.MAX_VALUE, Number.MAX_VALUE], [{ valueOf: () => 7.75 }, 7.75],
  ] as const;
  for (const [value, expected] of values) {
    const error = new QuotaExceededError("", { quota: value, requested: value });
    assert.equal(error.quota, expected);
    assert.equal(error.requested, expected);
  }
  const zero = new QuotaExceededError("", { quota: -0, requested: -0 });
  assert.ok(Object.is(zero.quota, -0));
  assert.ok(Object.is(zero.requested, -0));
});

test("QuotaExceededError constructor rejects nonfinite doubles, BigInt and Symbol", () => {
  for (const value of [NaN, Infinity, -Infinity, "NaN", "Infinity", 1n, Symbol("number")]) {
    assert.throws(() => new QuotaExceededError("", { quota: value }), TypeError);
    assert.throws(() => new QuotaExceededError("", { requested: value }), TypeError);
  }
});

test("QuotaExceededError constructor validates negative amounts and requested below quota", () => {
  for (const options of [{ quota: -1 }, { requested: -0.5 }, { quota: 5, requested: 4.5 }]) {
    assert.throws(() => new QuotaExceededError("", options), RangeError);
  }
  const equal = new QuotaExceededError("equal", { quota: 3.5, requested: 3.5 });
  assert.equal(equal.quota, 3.5);
  assert.equal(equal.requested, 3.5);
  const greater = new QuotaExceededError("greater", { quota: 3.5, requested: 4 });
  assert.equal(greater.requested, 4);
});

test("QuotaExceededError constructor retains each independent optional amount", () => {
  const quotaOnly = new QuotaExceededError("", { quota: 10 });
  assert.equal(quotaOnly.quota, 10);
  assert.equal(quotaOnly.requested, null);
  const requestedOnly = new QuotaExceededError("", { requested: 2 });
  assert.equal(requestedOnly.quota, null);
  assert.equal(requestedOnly.requested, 2);
});

test("QuotaExceededError constructor reads inherited dictionary members once and ignores extras", () => {
  const reads: string[] = [];
  class Options {
    get quota(): number { reads.push("quota"); return 5; }
    get requested(): number { reads.push("requested"); return 6; }
    get extra(): never { throw new Error("Unknown members must not be read"); }
  }
  const error = new QuotaExceededError("", new Options());
  assert.deepEqual(reads, ["quota", "requested"]);
  assert.equal(error.quota, 5);
  assert.equal(error.requested, 6);
  const callable = Object.assign(() => undefined, { quota: 8, requested: 9 });
  assert.equal(new QuotaExceededError("", callable).requested, 9);
});

test("QuotaExceededError constructor converts message before ordered dictionary members", () => {
  const steps: string[] = [];
  const error = new QuotaExceededError({
    [Symbol.toPrimitive](hint: string): string { steps.push("message:" + hint); return "quota"; },
  }, {
    get quota() {
      steps.push("get quota");
      return { [Symbol.toPrimitive](hint: string): number { steps.push("quota:" + hint); return 4; } };
    },
    get requested() {
      steps.push("get requested");
      return { [Symbol.toPrimitive](hint: string): number { steps.push("requested:" + hint); return 5; } };
    },
  });
  assert.deepEqual(steps, ["message:string", "get quota", "quota:number", "get requested", "requested:number"]);
  assert.equal(error.message, "quota");
  assert.equal(error.quota, 4);
  assert.equal(error.requested, 5);
});

test("QuotaExceededError constructor propagates conversion errors before range checks", () => {
  const sentinel = new Error("conversion");
  const unread = { get quota(): never { return assert.fail("Message conversion must finish first"); } };
  assert.throws(() => new QuotaExceededError({ toString(): never { throw sentinel; } }, unread),
    (error: unknown) => error === sentinel);
  assert.throws(() => new QuotaExceededError("", {
    get quota(): never { throw sentinel; },
    get requested(): never { return assert.fail("Quota conversion must finish first"); },
  }), (error: unknown) => error === sentinel);
  assert.throws(() => new QuotaExceededError("", {
    quota: -1,
    get requested(): never { throw sentinel; },
  }), (error: unknown) => error === sentinel);
  assert.throws(() => new QuotaExceededError("", { quota: -1, requested: Infinity }), TypeError);
});

test("QuotaExceededError constructor copies options and supports ordinary subclass construction", () => {
  const options = { quota: 2, requested: 3 };
  class CustomQuotaError extends QuotaExceededError {}
  const error = new CustomQuotaError("custom", options);
  options.quota = 20;
  options.requested = 30;
  assert.ok(error instanceof CustomQuotaError);
  assert.ok(error instanceof QuotaExceededError);
  assert.equal(error.quota, 2);
  assert.equal(error.requested, 3);
  assert.equal(error.name, "QuotaExceededError");
  assert.equal(error.code, 22);
});

test("getRandomValues throws the canonical QuotaExceededError before consuming entropy", () => {
  const { crypto, random } = fixture();
  const bytes = new Uint8Array(65_537).fill(0x3c);
  assert.throws(() => crypto.getRandomValues(bytes), (error: unknown) => {
    assert.ok(error instanceof QuotaExceededError);
    assert.equal(error.constructor, QuotaExceededError);
    assert.equal(error.name, "QuotaExceededError");
    assert.equal(error.code, 22);
    // Web Crypto supplies no quota or requested metadata when throwing.
    assert.equal(error.quota, null);
    assert.equal(error.requested, null);
    return true;
  });
  assert.equal(random.fills.length, 0);
  assert.ok(bytes.every((byte) => byte === 0x3c));
});

test("getRandomValues accepts the quota boundary for a view within a larger buffer", () => {
  const { crypto, random } = fixture();
  const bytes = new Uint8Array(65_552).fill(0x3c);
  const view = new Uint32Array(bytes.buffer, 8, 65_536 / 4);
  assert.equal(crypto.getRandomValues(view), view);
  assert.equal(random.fills.length, 1);
  assert.equal(random.fills[0]!.buffer, bytes.buffer);
  assert.equal(random.fills[0]!.byteOffset, 8);
  assert.equal(random.fills[0]!.byteLength, 65_536);
  assert.ok(bytes.subarray(0, 8).every((byte) => byte === 0x3c));
  assert.ok(bytes.subarray(8, 65_544).every((byte) => byte === 0xa5));
  assert.ok(bytes.subarray(65_544).every((byte) => byte === 0x3c));
});

test("getRandomValues rejects noninteger views before checking the quota", () => {
  const { crypto, random } = fixture();
  for (const view of [new Float32Array(20_000), new DataView(new ArrayBuffer(65_537))]) {
    assert.throws(() => crypto.getRandomValues(view), (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.ok(!(error instanceof QuotaExceededError));
      assert.equal(error.name, "TypeMismatchError");
      return true;
    });
  }
  assert.equal(random.fills.length, 0);
});
