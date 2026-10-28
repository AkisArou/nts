import assert from "node:assert/strict";
import test from "node:test";
import { TextDecoder, TextEncoder } from "../src/core/encoding.ts";

// Web IDL §3.7.6: check the operation's receiver before overload resolution
// converts its arguments. Encoding §7.2 and §7.4 define the two operations.
test("TextEncoder.encodeInto checks its receiver before source conversion", () => {
  const observed: string[] = [];
  const encodeInto = TextEncoder.prototype.encodeInto as (
    this: unknown,
    source: unknown,
    destination: Uint8Array,
  ) => unknown;
  const destination = new Uint8Array(1);
  assert.throws(() => encodeInto.call({}, {
    toString() {
      observed.push("source");
      return "x";
    },
  }, destination), TypeError);
  assert.deepEqual(observed, []);
  assert.deepEqual(destination, new Uint8Array(1));
});

test("TextDecoder.decode checks its receiver before reading stream options", () => {
  const observed: string[] = [];
  const decode = TextDecoder.prototype.decode as (
    this: unknown,
    input: Uint8Array,
    options: { readonly stream: boolean },
  ) => string;
  assert.throws(() => decode.call({}, Uint8Array.of(0x61), {
    get stream() {
      observed.push("stream");
      return true;
    },
  }), TypeError);
  assert.deepEqual(observed, []);
});

test("TextEncoder.encode checks its receiver before string conversion", () => {
  let converted = false;
  const encode = TextEncoder.prototype.encode as (this: unknown, input: unknown) => Uint8Array;
  assert.throws(() => encode.call({}, {
    toString() {
      converted = true;
      return "x";
    },
  }), TypeError);
  assert.equal(converted, false);
});

test("encoding operations accept genuine subclass receivers", () => {
  class Encoder extends TextEncoder {}
  class Decoder extends TextDecoder {}
  const destination = new Uint8Array(4);
  assert.deepEqual(new Encoder().encodeInto("\ud83d\udc99", destination), { read: 2, written: 4 });
  assert.equal(new Decoder().decode(destination), "\ud83d\udc99");
});
