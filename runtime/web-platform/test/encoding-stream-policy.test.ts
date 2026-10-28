import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { TextDecoderStream, TextEncoderStream } from "../src/core/encoding-streams.ts";
import type { TextDecoderOptions } from "../src/core/encoding.ts";
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
