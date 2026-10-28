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

// Web IDL §3.2.26 converts BufferSource without reading its bytes. Encoding
// §7.2 takes the byte copy only after converting the options dictionary.
test("TextDecoder treats a detached DataView as an empty byte sequence", () => {
  const buffer = Uint8Array.of(0x61).buffer;
  const view = new DataView(buffer);
  buffer.transfer();
  let optionsRead = false;
  assert.equal(new TextDecoder().decode(view, {
    get stream() {
      optionsRead = true;
      return false;
    },
  }), "");
  assert.equal(optionsRead, true);
});

test("TextDecoder reads the bytes after converting stream options", () => {
  const bytes = Uint8Array.of(0x61);
  assert.equal(new TextDecoder().decode(bytes, {
    get stream() {
      bytes[0] = 0x62;
      return false;
    },
  }), "b");
});

test("TextDecoder accepts a DataView detached during option conversion", () => {
  const buffer = Uint8Array.of(0x61).buffer;
  const view = new DataView(buffer);
  assert.equal(new TextDecoder().decode(view, {
    get stream() {
      buffer.transfer();
      return false;
    },
  }), "");
});

test("TextDecoder rejects resizable buffer inputs before options conversion", () => {
  const inputs = [
    new ArrayBuffer(2, { maxByteLength: 4 }),
    new SharedArrayBuffer(2, { maxByteLength: 4 }),
    new Uint8Array(new ArrayBuffer(2, { maxByteLength: 4 })),
    new DataView(new ArrayBuffer(2, { maxByteLength: 4 })),
    new Uint8Array(new SharedArrayBuffer(2, { maxByteLength: 4 })),
    new DataView(new SharedArrayBuffer(2, { maxByteLength: 4 })),
  ];
  for (const input of inputs) {
    let optionsRead = false;
    assert.throws(() => new TextDecoder().decode(input, {
      get stream() {
        optionsRead = true;
        return false;
      },
    }), TypeError);
    assert.equal(optionsRead, false);
  }
});

test("TextEncoder.encodeInto rejects resizable destinations after source conversion", () => {
  for (const buffer of [
    new ArrayBuffer(2, { maxByteLength: 4 }),
    new SharedArrayBuffer(2, { maxByteLength: 4 }),
  ]) {
    let converted = false;
    const encoder = new TextEncoder();
    const encodeInto = encoder.encodeInto as (source: unknown, destination: Uint8Array) => unknown;
    assert.throws(() => encodeInto.call(encoder, {
      toString() {
        converted = true;
        return "a";
      },
    }, new Uint8Array(buffer)), TypeError);
    assert.equal(converted, true);
  }
});

test("fixed shared buffers remain valid at both encoding boundaries", () => {
  const buffer = new SharedArrayBuffer(4);
  const bytes = new Uint8Array(buffer);
  assert.deepEqual(new TextEncoder().encodeInto("\ud83d\udc99", bytes), { read: 2, written: 4 });
  assert.equal(new TextDecoder().decode(new DataView(buffer)), "\ud83d\udc99");
});

test("ordinary decoder properties cannot reset a pending UTF-8 sequence", () => {
  const decoder = new TextDecoder();
  assert.equal(decoder.decode(Uint8Array.of(0xc2), { stream: true }), "");
  Object.assign(decoder, { needed: 0, seen: 0, code: 0, doNotFlush: false });
  assert.equal(decoder.decode(Uint8Array.of(0xa2)), "\u00a2");
});

test("ordinary decoder properties cannot change UTF-16 or BOM state", () => {
  const decoder = new TextDecoder("utf-16le");
  assert.equal(decoder.decode(Uint8Array.of(0xff), { stream: true }), "");
  Object.assign(decoder, { pendingByte: 0x61, pendingLead: 0xd800, bomSeen: true });
  assert.equal(decoder.decode(Uint8Array.of(0xfe, 0x61, 0)), "a");
});

test("encoding classes retain their ordinary string tags", () => {
  assert.equal(Object.prototype.toString.call(new TextEncoder()), "[object TextEncoder]");
  assert.equal(Object.prototype.toString.call(new TextDecoder()), "[object TextDecoder]");
});
