import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { TextDecoderStream, TextEncoderStream } from "../src/core/encoding-streams.ts";
import type { AllowSharedBufferSource, TextDecoderOptions } from "../src/core/encoding.ts";
import type { ReadableStream } from "../src/streams/readable.ts";

async function collect<T>(readable: ReadableStream<T>): Promise<T[]> {
  const reader = readable.getReader();
  const output: T[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return output;
      output.push(chunk.value as T);
    }
  } finally {
    reader.releaseLock();
  }
}

async function encodeChunks(chunks: readonly unknown[]): Promise<number[][]> {
  const stream = new TextEncoderStream();
  const writer = stream.writable.getWriter();
  const reading = collect(stream.readable);
  const writing = (async (): Promise<void> => {
    try {
      for (const chunk of chunks) await writer.write(chunk as string);
      await writer.close();
    } finally {
      writer.releaseLock();
    }
  })();
  const [output] = await Promise.all([reading, writing]);
  return output.map((chunk) => Array.from(chunk));
}

// Encoding #encode-and-enqueue-a-chunk; Web IDL #es-DOMString.
test("TextEncoderStream rejects Symbol chunks instead of describing them", async () => {
  await assert.rejects(encodeChunks([Symbol("chunk")]), TypeError);
});

test("TextEncoderStream converts a chunk once with the string hint", async () => {
  const hints: string[] = [];
  const chunk = {
    [Symbol.toPrimitive](hint: string): string {
      hints.push(hint);
      return "A";
    },
  };
  assert.deepEqual(await encodeChunks([chunk]), [[0x41]]);
  assert.deepEqual(hints, ["string"]);
});

function constructDecoder(label: unknown, options: unknown): TextDecoderStream {
  return new TextDecoderStream(label as string, options as TextDecoderOptions);
}

// Encoding #dom-textdecoderstream; Web IDL #es-operations and #es-dictionary.
test("TextDecoderStream converts the label before rejecting a primitive dictionary", () => {
  const order: string[] = [];
  const label = { toString() { order.push("label"); return "utf-8"; } };
  assert.throws(() => constructDecoder(label, 1), TypeError);
  assert.deepEqual(order, ["label"]);
});

test("TextDecoderStream preserves label conversion failure before options conversion", () => {
  const failure = {};
  const label = { toString(): never { throw failure; } };
  assert.throws(() => constructDecoder(label, false), (error: unknown) => error === failure);
});

test("TextDecoderStream reads and converts its dictionary once in member order", () => {
  const order: string[] = [];
  const label = { toString() { order.push("label"); return "UTF-16BE"; } };
  const options = {
    get fatal() { order.push("fatal"); return 1; },
    get ignoreBOM() { order.push("ignoreBOM"); return 0; },
  };
  const decoder = constructDecoder(label, options);
  assert.deepEqual(order, ["label", "fatal", "ignoreBOM"]);
  assert.equal(decoder.encoding, "utf-16be");
  assert.equal(decoder.fatal, true);
  assert.equal(decoder.ignoreBOM, false);
});

test("TextDecoderStream finishes dictionary conversion before label lookup", () => {
  const failure = {};
  const options = { get fatal(): never { throw failure; } };
  assert.throws(() => new TextDecoderStream("not-an-encoding", options),
    (error: unknown) => error === failure);
});

async function decodeChunks(
  chunks: readonly unknown[],
  label = "utf-8",
  options?: TextDecoderOptions,
): Promise<string[]> {
  const stream = new TextDecoderStream(label, options);
  const writer = stream.writable.getWriter();
  const reading = collect(stream.readable);
  const writing = (async (): Promise<void> => {
    try {
      for (const chunk of chunks) await writer.write(chunk as AllowSharedBufferSource);
      await writer.close();
    } finally {
      writer.releaseLock();
    }
  })();
  const [output] = await Promise.all([reading, writing]);
  return output;
}

test("encoding streams expose plain tags and branded attributes", () => {
  const encoder = new TextEncoderStream();
  const decoder = new TextDecoderStream();
  assert.equal(Object.prototype.toString.call(encoder), "[object TextEncoderStream]");
  assert.equal(Object.prototype.toString.call(decoder), "[object TextDecoderStream]");
  assert.equal(encoder.encoding, "utf-8");
  assert.equal(decoder.encoding, "utf-8");
  assert.equal(decoder.fatal, false);
  assert.equal(decoder.ignoreBOM, false);
  assert.equal(encoder.readable, encoder.readable);
  assert.equal(encoder.writable, encoder.writable);
  assert.equal(decoder.readable, decoder.readable);
  assert.equal(decoder.writable, decoder.writable);
  assert.throws(() => TextEncoderStream.prototype.encoding, TypeError);
  assert.throws(() => TextEncoderStream.prototype.readable, TypeError);
  assert.throws(() => TextEncoderStream.prototype.writable, TypeError);
  assert.throws(() => TextDecoderStream.prototype.encoding, TypeError);
  assert.throws(() => TextDecoderStream.prototype.fatal, TypeError);
  assert.throws(() => TextDecoderStream.prototype.ignoreBOM, TypeError);
  assert.throws(() => TextDecoderStream.prototype.readable, TypeError);
  assert.throws(() => TextDecoderStream.prototype.writable, TypeError);
});

// Encoding #convert-code-unit-to-scalar-value and #encode-and-flush.
test("TextEncoderStream joins a split surrogate pair across empty chunks", async () => {
  assert.deepEqual(await encodeChunks(["", "A\ud83d", "", "\ude00B", ""]), [
    [0x41], [0xf0, 0x9f, 0x98, 0x80, 0x42],
  ]);
});

test("TextEncoderStream flushes a final high surrogate exactly once", async () => {
  assert.deepEqual(await encodeChunks(["A\ud800", ""]), [[0x41], [0xef, 0xbf, 0xbd]]);
  assert.deepEqual(await encodeChunks(["", ""]), []);
});

test("TextEncoderStream replaces unpaired surrogates without swallowing the next unit", async () => {
  assert.deepEqual(await encodeChunks(["\ud800", "\ud801", "A\udc00"]), [
    [0xef, 0xbf, 0xbd],
    [0xef, 0xbf, 0xbd, 0x41, 0xef, 0xbf, 0xbd],
  ]);
});

test("TextEncoderStream retains arbitrary string-conversion failures", async () => {
  const failure = {};
  await assert.rejects(encodeChunks([{ toString(): never { throw failure; } }]),
    (error: unknown) => error === failure);
});

test("TextEncoderStream stringifies null, undefined and primitive values", async () => {
  const chunks = await encodeChunks([null, undefined, false, 42, 12n]);
  const output = chunks.map((bytes) => String.fromCharCode(...bytes));
  assert.deepEqual(output, ["null", "undefined", "false", "42", "12"]);
});

test("TextEncoderStream waits for readable demand before converting a chunk", async () => {
  const stream = new TextEncoderStream();
  const writer = stream.writable.getWriter();
  let calls = 0;
  const chunk = { toString() { calls++; return "A"; } };
  const writing = writer.write(chunk as unknown as string);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 0);
  const reader = stream.readable.getReader();
  const first = await reader.read();
  await writing;
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(first.value as Uint8Array), [0x41]);
  await writer.close();
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
  writer.releaseLock();
});

// Encoding #decode-and-enqueue-a-chunk, #flush-and-enqueue and #serialize-i-o-queue.
test("TextDecoderStream buffers split UTF-8 input without emitting empty strings", async () => {
  assert.deepEqual(await decodeChunks([
    new Uint8Array(), new Uint8Array([0xf0]), new Uint8Array([0x9f, 0x98]),
    new Uint8Array(), new Uint8Array([0x80, 0x41]), new Uint8Array(),
  ]), ["😀A"]);
});

test("TextDecoderStream strips only the first complete BOM", async () => {
  const chunks = [
    new Uint8Array([0xef]), new Uint8Array(), new Uint8Array([0xbb]),
    new Uint8Array([0xbf]), new Uint8Array([0x41]), new Uint8Array([0xef, 0xbb, 0xbf]),
  ];
  assert.deepEqual(await decodeChunks(chunks), ["A", "\ufeff"]);
  assert.deepEqual(await decodeChunks(chunks, "utf-8", { ignoreBOM: true }),
    ["\ufeff", "A", "\ufeff"]);
});

test("TextDecoderStream never strips a BOM after a replacement character", async () => {
  assert.deepEqual(await decodeChunks([
    new Uint8Array([0xff]), new Uint8Array([0xef, 0xbb, 0xbf]),
  ]), ["\ufffd", "\ufeff"]);
});

test("TextDecoderStream restores an invalid continuation as the next input byte", async () => {
  assert.deepEqual(await decodeChunks([
    new Uint8Array([0xe2]), new Uint8Array([0x41, 0xc0, 0xaf, 0xe2, 0x82]),
  ]), ["\ufffdA\ufffd\ufffd", "\ufffd"]);
});

for (const [label, bytes] of [
  ["utf-16le", [0xff, 0xfe, 0x3d, 0xd8, 0x00, 0xde, 0x41, 0x00]],
  ["utf-16be", [0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00, 0x00, 0x41]],
] as const) {
  test(`TextDecoderStream retains ${label} bytes and surrogate state across chunks`, async () => {
    assert.deepEqual(await decodeChunks(bytes.map((byte) => new Uint8Array([byte])), label),
      ["😀", "A"]);
    assert.deepEqual(await decodeChunks(bytes.map((byte) => new Uint8Array([byte])), label,
      { ignoreBOM: true }), ["\ufeff", "😀", "A"]);
  });
}

test("TextDecoderStream uses UTF-16 label endianness instead of sniffing a BOM", async () => {
  assert.deepEqual(await decodeChunks([new Uint8Array([0xfe, 0xff, 0x00, 0x41])], "utf-16"),
    ["\ufffe\u4100"]);
});

test("TextDecoderStream decodes only the bytes inside a view", async () => {
  const backing = new Uint8Array([0xff, 0x41, 0x42, 0xff]);
  assert.deepEqual(await decodeChunks([new DataView(backing.buffer, 1, 2)]), ["AB"]);
  assert.deepEqual(await decodeChunks([backing.subarray(1, 3)]), ["AB"]);
});

test("TextDecoderStream refuses every non-buffer-source chunk", async () => {
  for (const chunk of [undefined, null, 0, "A", {}, [0x41], Symbol("bytes")]) {
    await assert.rejects(decodeChunks([chunk]), TypeError);
  }
});

test("TextDecoderStream errors both stream sides with the same fatal-chunk error", async () => {
  const stream = new TextDecoderStream("utf-8", { fatal: true });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const results = await Promise.allSettled([
    reader.read(), reader.closed, writer.closed, writer.write(new Uint8Array([0x41, 0xff])),
  ]);
  let failure: unknown;
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") continue;
    assert.ok(result.reason instanceof TypeError);
    if (failure === undefined) failure = result.reason;
    assert.equal(result.reason, failure);
  }
  reader.releaseLock();
  writer.releaseLock();
});

for (const [label, bytes] of [
  ["utf-8", [0xe2, 0x82]],
  ["utf-16le", [0x00, 0xd8, 0x41]],
  ["utf-16be", [0xd8, 0x00, 0x41]],
] as const) {
  test(`TextDecoderStream flushes incomplete ${label} input with the chosen error policy`, async () => {
    assert.deepEqual(await decodeChunks([new Uint8Array(bytes)], label), ["\ufffd"]);
    await assert.rejects(decodeChunks([new Uint8Array(bytes)], label, { fatal: true }), TypeError);
  });
}
