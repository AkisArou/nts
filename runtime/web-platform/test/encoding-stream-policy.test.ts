import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { TextDecoderStream, TextEncoderStream } from "../src/core/encoding-streams.ts";
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
