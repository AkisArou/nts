import assert from "node:assert/strict";
import test from "node:test";
import {
  brotliCompressSync,
  brotliDecompressSync,
  deflateRawSync,
  deflateSync,
  gzipSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";

import "../host/environment-shim.ts";
import {
  CompressionStream,
  DecompressionStream,
  createCompressionStream,
  createDecompressionStream,
} from "../src/compression/compression-stream.ts";
import type {
  CompressionContext,
  CompressionFailure,
  CompressionFlush,
  CompressionFormat,
  CompressionProvider,
  CompressionResult,
} from "../src/provider/compression.ts";
import { ReadableStream } from "../src/streams/readable.ts";
import { WritableStream } from "../src/streams/writable.ts";
import { NodeCompressionProvider } from "./node-compression-provider.ts";

// Original specification controls, not imported or edited WPT fixtures.
// Compression §§2–5: https://compression.spec.whatwg.org/
// Brotli compliance: https://www.rfc-editor.org/rfc/rfc7932#section-1.4
// Web IDL enum conversion: https://webidl.spec.whatwg.org/#es-enumeration
// Streams transform setup: https://streams.spec.whatwg.org/#transformstream-set-up
// Descriptor-only and intrinsic-prototype-spoofing cases are outside nts's layout.
// These algorithm controls inject only through the internal factories; public
// runtime construction is covered separately in compression-runtime.test.ts.

interface ByteTransform {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<unknown>;
}

interface ProcessCall {
  readonly input: Uint8Array;
  readonly flush: CompressionFlush;
  readonly maximum: number;
}

class RecordingContext implements CompressionContext {
  readonly calls: ProcessCall[] = [];
  closeCount = 0;
  resetCount = 0;
  produce: (input: Uint8Array, flush: CompressionFlush) => CompressionResult | CompressionFailure =
    (input) => ({ chunks: [], consumed: input.byteLength });

  process(input: Uint8Array, flush: CompressionFlush, maximum: number): CompressionResult | CompressionFailure {
    this.calls.push({ input, flush, maximum });
    return this.produce(input, flush);
  }

  reset(): void {
    this.resetCount++;
  }

  close(): void {
    // Deliberately count every call: surface cleanup must happen only once.
    this.closeCount++;
  }
}

class RecordingProvider implements CompressionProvider {
  readonly context = new RecordingContext();
  readonly creations: { direction: string; format: CompressionFormat; windowBits: number }[] = [];
  failure: CompressionFailure | undefined;

  createCompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    this.creations.push({ direction: "compress", format, windowBits });
    return this.failure ?? this.context;
  }

  createDecompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    this.creations.push({ direction: "decompress", format, windowBits });
    return this.failure ?? this.context;
  }
}

const formats: readonly CompressionFormat[] = ["gzip", "deflate", "deflate-raw", "brotli"];
const directions = [
  { name: "CompressionStream", direction: "compress", create: createCompressionStream },
  { name: "DecompressionStream", direction: "decompress", create: createDecompressionStream },
];

function join(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function nativeCompress(format: CompressionFormat, bytes: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return gzipSync(bytes);
    case "deflate": return deflateSync(bytes);
    case "deflate-raw": return deflateRawSync(bytes);
    case "brotli": return brotliCompressSync(bytes);
  }
}

function nativeDecompress(format: CompressionFormat, bytes: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return gunzipSync(bytes);
    case "deflate": return inflateSync(bytes);
    case "deflate-raw": return inflateRawSync(bytes);
    case "brotli": return brotliDecompressSync(bytes);
  }
}

async function readChunks(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return chunks;
      assert.ok(result.value instanceof Uint8Array, "output is a Uint8Array");
      assert.ok(result.value.byteLength > 0, "empty output is not enqueued");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function transform(stream: ByteTransform, inputs: readonly unknown[]): Promise<Uint8Array[]> {
  const writer = stream.writable.getWriter();
  const output = readChunks(stream.readable);
  const write = (async () => {
    for (const input of inputs) await writer.write(input);
    await writer.close();
  })();
  const [, chunks] = await Promise.all([write, output]);
  writer.releaseLock();
  return chunks;
}

async function expectTypeError(stream: ByteTransform, inputs: readonly unknown[]): Promise<void> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const write = (async () => {
    for (const input of inputs) await writer.write(input);
    await writer.close();
  })();
  const read = (async () => {
    for (;;) {
      if ((await reader.read()).done) return;
    }
  })();
  const outcomes = await Promise.allSettled([write, read, writer.closed, reader.closed]);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "rejected", "both stream sides and their closed promises reject");
    if (outcome.status === "rejected") assert.ok(outcome.reason instanceof TypeError);
  }
}

function bytes(length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (let i = 0; i < result.length; i++) result[i] = (i * 31 + (i >>> 3)) & 255;
  return result;
}

const bufferSources: readonly { name: string; make: (buffer: ArrayBuffer) => unknown }[] = [
  { name: "ArrayBuffer", make: (buffer) => buffer },
  { name: "Int8Array", make: (buffer) => new Int8Array(buffer) },
  { name: "Uint8Array", make: (buffer) => new Uint8Array(buffer) },
  { name: "Uint8ClampedArray", make: (buffer) => new Uint8ClampedArray(buffer) },
  { name: "Int16Array", make: (buffer) => new Int16Array(buffer) },
  { name: "Uint16Array", make: (buffer) => new Uint16Array(buffer) },
  { name: "Int32Array", make: (buffer) => new Int32Array(buffer) },
  { name: "Uint32Array", make: (buffer) => new Uint32Array(buffer) },
  { name: "Float16Array", make: (buffer) => new Float16Array(buffer) },
  { name: "Float32Array", make: (buffer) => new Float32Array(buffer) },
  { name: "Float64Array", make: (buffer) => new Float64Array(buffer) },
  { name: "BigInt64Array", make: (buffer) => new BigInt64Array(buffer) },
  { name: "BigUint64Array", make: (buffer) => new BigUint64Array(buffer) },
  { name: "DataView", make: (buffer) => new DataView(buffer) },
];

test("compression classes keep canonical identity and reject public construction without a runtime", async () => {
  assert.throws(() => new CompressionStream("gzip"), TypeError);
  assert.throws(() => new DecompressionStream("gzip"), TypeError);
  const compressor = createCompressionStream("gzip", new RecordingProvider());
  const decompressor = createDecompressionStream("gzip", new RecordingProvider());
  assert.ok(compressor instanceof CompressionStream);
  assert.ok(decompressor instanceof DecompressionStream);
  for (const [stream, name] of [[compressor, "CompressionStream"], [decompressor, "DecompressionStream"]] as const) {
    assert.ok(stream.readable instanceof ReadableStream);
    assert.ok(stream.writable instanceof WritableStream);
    assert.equal(stream.readable, stream.readable);
    assert.equal(stream.writable, stream.writable);
    assert.equal(stream[Symbol.toStringTag], name);
    assert.equal(Object.prototype.toString.call(stream), "[object " + name + "]");
    await stream.readable.cancel();
  }
});

for (const direction of directions) {
  test(direction.name + " converts the format once and forwards the capability arguments", async () => {
    for (const format of formats) {
      const provider = new RecordingProvider();
      let calls = 0;
      const stream = direction.create({
        toString() {
          calls++;
          return format;
        },
      }, provider);
      assert.equal(calls, 1);
      assert.deepEqual(provider.creations, [{ direction: direction.direction, format, windowBits: 15 }]);
      await stream.readable.cancel();
      assert.equal(provider.context.closeCount, 1);
    }
  });

  test(direction.name + " rejects unsupported formats and preserves conversion exceptions before native creation", () => {
    const provider = new RecordingProvider();
    for (const value of [undefined, null, "", "GZIP", " gzip", "gzip ", "zlib", "br", "BROTLI", " brotli", "brotli ", 1, Symbol("gzip")]) {
      assert.throws(() => direction.create(value, provider), TypeError);
    }
    const sentinel = new Error("format conversion");
    assert.throws(() => direction.create({ toString() { throw sentinel; } }, provider), (error) => error === sentinel);
    assert.equal(provider.creations.length, 0);
  });

  test(direction.name + " turns native creation failures into TypeError", () => {
    for (const format of formats) {
      for (const failure of ["invalid-data", "output-limit", "unsupported", "operation"] as const) {
        const provider = new RecordingProvider();
        provider.failure = { failure };
        assert.throws(() => direction.create(format, provider), TypeError);
        assert.equal(provider.creations.length, 1);
        assert.equal(provider.context.closeCount, 0);
      }
    }
  });

  test(direction.name + " rejects non-BufferSource, shared and resizable chunks on both sides", { timeout: 10_000 }, async () => {
    const shared = new SharedArrayBuffer(8);
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const bad: readonly unknown[] = [
      undefined, null, 3.14, 1n, false, "bytes", Symbol("bytes"), {}, [1, 2], () => {},
      shared, new Uint8Array(shared), new DataView(shared),
      resizable, new Uint8Array(resizable), new DataView(resizable),
    ];
    for (const input of bad) {
      const provider = new RecordingProvider();
      await expectTypeError(direction.create("gzip", provider), [input]);
      assert.equal(provider.context.calls.length, 0, "invalid input never reaches native code");
      assert.equal(provider.context.closeCount, 1);
    }
  });

  test(direction.name + " borrows complete view ranges and transfers output without another copy", async () => {
    const provider = new RecordingProvider();
    const first = new Uint8Array([11, 12]);
    const last = new Uint8Array([13]);
    provider.context.produce = (input, flush) => ({
      chunks: flush === "none" ? [first] : [last],
      consumed: input.byteLength,
    });
    const backing = bytes(32);
    const input = new Uint8Array(backing.buffer, 8, 16);
    const output = await transform(direction.create("gzip", provider), [input]);
    assert.equal(provider.context.calls.length, 2);
    assert.equal(provider.context.calls[0]?.input, input, "Uint8Array input is borrowed directly");
    assert.equal(provider.context.calls[0]?.input.buffer, backing.buffer);
    assert.equal(provider.context.calls[0]?.input.byteOffset, 8);
    assert.equal(provider.context.calls[0]?.input.byteLength, 16);
    assert.equal(provider.context.calls[0]?.flush, "none");
    assert.equal(provider.context.calls[0]?.maximum, Infinity);
    assert.equal(provider.context.calls[1]?.flush, "finish");
    assert.equal(provider.context.calls[1]?.input.byteLength, 0);
    assert.equal(output[0], first, "native result ownership transfers directly");
    assert.equal(output[1], last);
    assert.equal(provider.context.closeCount, 1);
    assert.equal(provider.context.resetCount, 0);
  });

  test(direction.name + " uses byte ranges of DataView and multi-byte arrays without copying", async () => {
    for (const input of [new DataView(new ArrayBuffer(32), 3, 7), new Uint16Array(new ArrayBuffer(32), 8, 5)]) {
      const provider = new RecordingProvider();
      await transform(direction.create("gzip", provider), [input]);
      const received = provider.context.calls[0]?.input;
      assert.ok(received instanceof Uint8Array);
      assert.equal(received.buffer, input.buffer);
      assert.equal(received.byteOffset, input.byteOffset);
      assert.equal(received.byteLength, input.byteLength);
    }
  });

  test(direction.name + " treats detached BufferSources as empty chunks", async () => {
    const arrayBuffer = new ArrayBuffer(8);
    const viewBuffer = new ArrayBuffer(8);
    const view = new Uint8Array(viewBuffer);
    arrayBuffer.transfer();
    viewBuffer.transfer();
    const provider = new RecordingProvider();
    assert.deepEqual(await transform(direction.create("gzip", provider), [arrayBuffer, view]), []);
    assert.deepEqual(provider.context.calls.map((call) => [call.input.byteLength, call.flush]), [
      [0, "none"], [0, "none"], [0, "finish"],
    ]);
  });

  test(direction.name + " holds native work behind readable backpressure", async () => {
    for (const format of formats) {
      const provider = new RecordingProvider();
      provider.context.produce = (input, flush) => ({
        chunks: flush === "none" ? [input.slice()] : [],
        consumed: input.byteLength,
      });
      const stream = direction.create(format, provider);
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const input = new Uint8Array([1, 2, 3]);
      const firstWrite = writer.write(input);
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(provider.context.calls.length, 0);
      input[0] = 7;
      assert.deepEqual((await reader.read()).value, new Uint8Array([7, 2, 3]));
      await firstWrite;
      assert.equal(provider.context.calls.length, 1);
      const secondWrite = writer.write(new Uint8Array([4, 5]));
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(provider.context.calls.length, 1, "each next write waits for demand");
      assert.deepEqual((await reader.read()).value, new Uint8Array([4, 5]));
      await secondWrite;
      await writer.close();
      assert.equal((await reader.read()).done, true);
      assert.deepEqual(provider.context.calls.map((call) => call.flush), ["none", "none", "finish"]);
      assert.equal(provider.context.closeCount, 1);
    }
  });

  test(direction.name + " errors both sides and releases its context on native process failure", async () => {
    for (const failure of ["invalid-data", "output-limit", "unsupported", "operation"] as const) {
      const provider = new RecordingProvider();
      provider.context.produce = () => ({ failure });
      await expectTypeError(direction.create("gzip", provider), [new Uint8Array([1, 2, 3])]);
      assert.equal(provider.context.calls.length, 1);
      assert.equal(provider.context.closeCount, 1);
    }
  });

  test(direction.name + " errors both sides and releases its context on native finish failure", async () => {
    const provider = new RecordingProvider();
    provider.context.produce = (input, flush) => flush === "finish"
      ? { failure: "operation" }
      : { chunks: [], consumed: input.byteLength };
    await expectTypeError(direction.create("gzip", provider), [new Uint8Array(0)]);
    assert.deepEqual(provider.context.calls.map((call) => call.flush), ["none", "finish"]);
    assert.equal(provider.context.closeCount, 1);
  });

  test(direction.name + " releases an unused context and propagates readable cancellation", async () => {
    const provider = new RecordingProvider();
    const stream = direction.create("gzip", provider);
    const writer = stream.writable.getWriter();
    const reason = new Error("cancel readable");
    const closed = assert.rejects(writer.closed, (error) => error === reason);
    await stream.readable.cancel(reason);
    await closed;
    await assert.rejects(writer.write(new Uint8Array([1])), (error) => error === reason);
    assert.equal(provider.context.calls.length, 0);
    assert.equal(provider.context.closeCount, 1);
  });

  test(direction.name + " unblocks a queued write when its readable side is cancelled", async () => {
    const provider = new RecordingProvider();
    const stream = direction.create("gzip", provider);
    const writer = stream.writable.getWriter();
    const reason = new Error("cancel queued write");
    const write = assert.rejects(writer.write(new Uint8Array([1])), (error) => error === reason);
    const closed = assert.rejects(writer.closed, (error) => error === reason);
    await stream.readable.cancel(reason);
    await Promise.all([write, closed]);
    assert.equal(provider.context.calls.length, 0);
    assert.equal(provider.context.closeCount, 1);
  });

  test(direction.name + " releases its context and propagates writable abort", async () => {
    const provider = new RecordingProvider();
    const stream = direction.create("gzip", provider);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const reason = new Error("abort writable");
    const read = assert.rejects(reader.read(), (error) => error === reason);
    const closed = assert.rejects(reader.closed, (error) => error === reason);
    await writer.abort(reason);
    await Promise.all([read, closed]);
    assert.equal(provider.context.calls.length, 0);
    assert.equal(provider.context.closeCount, 1);
  });
}

for (const format of formats) {
  test(format + " compresses multiple chunks and flushes a complete native stream", { timeout: 10_000 }, async () => {
    const input = bytes(128 * 1024 + 37);
    const chunks = [input.subarray(0, 1), new Uint8Array(0), input.subarray(1, 32769), input.subarray(32769)];
    const compressed = join(await transform(createCompressionStream(format, new NodeCompressionProvider()), chunks));
    assert.deepEqual(new Uint8Array(nativeDecompress(format, compressed)), input);
    const expected = nativeCompress(format, input);
    const decompressed = await transform(createDecompressionStream(format, new NodeCompressionProvider()), [
      expected.subarray(0, 1), new Uint8Array(0), expected.subarray(1, 8), expected.subarray(8),
    ]);
    assert.deepEqual(join(decompressed), input);
  });

  test(format + " emits a complete empty compressed stream and no empty decompressed chunks", async () => {
    const empty = new Uint8Array(0);
    const compressed = join(await transform(createCompressionStream(format, new NodeCompressionProvider()), [empty, empty]));
    assert.ok(compressed.length > 0);
    assert.equal(nativeDecompress(format, compressed).length, 0);
    assert.deepEqual(await transform(createDecompressionStream(format, new NodeCompressionProvider()), [compressed, empty]), []);
    await expectTypeError(createDecompressionStream(format, new NodeCompressionProvider()), []);
  });

  test(format + " accepts each ordinary BufferSource kind as compression input", { timeout: 10_000 }, async () => {
    const input = bytes(32);
    for (const kind of bufferSources) {
      const compressed = join(await transform(createCompressionStream(format, new NodeCompressionProvider()), [kind.make(input.slice().buffer)]));
      assert.deepEqual(new Uint8Array(nativeDecompress(format, compressed)), input, kind.name);
    }
  });

  test(format + " accepts each ordinary BufferSource kind as decompression input", { timeout: 10_000 }, async () => {
    // Generate a native stream divisible by eight, so every view exposes the
    // same exact bytes without inventing padding after the compressed stream.
    let input = bytes(1);
    let encoded = nativeCompress(format, input);
    for (let length = 2; encoded.length % 8 !== 0 && length < 256; length++) {
      input = bytes(length);
      encoded = nativeCompress(format, input);
    }
    assert.equal(encoded.length % 8, 0);
    for (const kind of bufferSources) {
      const copy = new Uint8Array(encoded);
      const output = join(await transform(createDecompressionStream(format, new NodeCompressionProvider()), [kind.make(copy.buffer)]));
      assert.deepEqual(output, input, kind.name);
    }
  });

  test(format + " consumes only the byte range of input views", async () => {
    const input = bytes(64);
    const expected = input.subarray(7, 31);
    const compressed = join(await transform(createCompressionStream(format, new NodeCompressionProvider()), [
      new DataView(input.buffer, 7, 24),
    ]));
    assert.deepEqual(new Uint8Array(nativeDecompress(format, compressed)), expected);
    const encoded = nativeCompress(format, expected);
    const padded = new Uint8Array(encoded.length + 16);
    padded.fill(0xff);
    padded.set(encoded, 8);
    assert.deepEqual(join(await transform(createDecompressionStream(format, new NodeCompressionProvider()), [
      new DataView(padded.buffer, 8, encoded.length),
    ])), expected);
  });

  test(format + " accepts every split across native headers, blocks and trailers", { timeout: 10_000 }, async () => {
    const input = bytes(31);
    const encoded = nativeCompress(format, input);
    for (let split = 0; split <= encoded.length; split++) {
      const output = await transform(createDecompressionStream(format, new NodeCompressionProvider()), [
        encoded.subarray(0, split), encoded.subarray(split),
      ]);
      assert.deepEqual(join(output), input, "split at byte " + split);
    }
  });

  test(format + " rejects every incomplete prefix on finish", { timeout: 10_000 }, async () => {
    const encoded = nativeCompress(format, bytes(23));
    for (let length = 0; length < encoded.length; length++) {
      await expectTypeError(createDecompressionStream(format, new NodeCompressionProvider()), [encoded.subarray(0, length)]);
    }
  });

  test(format + " delivers decoded data before rejecting same-chunk trailing bytes", async () => {
    const input = bytes(8);
    const encoded = nativeCompress(format, input);
    const stream = createDecompressionStream(format, new NodeCompressionProvider());
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const firstRead = reader.read();
    const write = assert.rejects(writer.write(join([encoded, new Uint8Array([0])])), TypeError);
    assert.deepEqual((await firstRead).value, input);
    await Promise.all([write, assert.rejects(reader.read(), TypeError), assert.rejects(writer.closed, TypeError)]);
  });

  test(format + " rejects trailing bytes arriving in another chunk", async () => {
    const input = bytes(8);
    const stream = createDecompressionStream(format, new NodeCompressionProvider());
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const firstRead = reader.read();
    await writer.write(nativeCompress(format, input));
    assert.deepEqual((await firstRead).value, input);
    const nextRead = assert.rejects(reader.read(), TypeError);
    const write = assert.rejects(writer.write(new Uint8Array([0])), TypeError);
    await Promise.all([nextRead, write]);
  });
}

test("decompression validates Adler-32, CRC-32 and gzip ISIZE in the native provider", async () => {
  const input = bytes(100);
  for (const [format, fromEnd] of [["deflate", 4], ["gzip", 8], ["gzip", 4]] as const) {
    const corrupted = new Uint8Array(nativeCompress(format, input));
    const index = corrupted.length - fromEnd;
    corrupted[index] = corrupted[index]! ^ 1;
    await expectTypeError(createDecompressionStream(format, new NodeCompressionProvider()), [corrupted]);
  }
});

test("decompression rejects a native zlib stream with the unsupported FDICT flag", async () => {
  const encoded = deflateSync(bytes(128), { dictionary: bytes(32) });
  await expectTypeError(createDecompressionStream("deflate", new NodeCompressionProvider()), [encoded]);
});

test("decompression rejects invalid native format headers", async () => {
  for (const format of ["gzip", "deflate"] as const) {
    const encoded = new Uint8Array(nativeCompress(format, bytes(10)));
    encoded[0] = 0;
    await expectTypeError(createDecompressionStream(format, new NodeCompressionProvider()), [encoded]);
  }
  const reservedFlags = new Uint8Array(gzipSync(bytes(10)));
  reservedFlags[3] = 0xe0;
  await expectTypeError(createDecompressionStream("gzip", new NodeCompressionProvider()), [reservedFlags]);
});

test("gzip permits one member and delivers its output before rejecting a second", async () => {
  const input = bytes(8);
  const encoded = join([gzipSync(input), gzipSync(new Uint8Array([99]))]);
  const stream = createDecompressionStream("gzip", new NodeCompressionProvider());
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const first = reader.read();
  const write = assert.rejects(writer.write(encoded), TypeError);
  assert.deepEqual((await first).value, input);
  await Promise.all([write, assert.rejects(reader.read(), TypeError)]);
});

test("decompression enqueues the native finish prefix before reporting incomplete input", async () => {
  for (const format of formats) {
    const provider = new RecordingProvider();
    const prefix = new Uint8Array([17, 18, 19]);
    provider.context.produce = (input, flush) => flush === "finish"
      ? { failure: "incomplete", chunks: [prefix] }
      : { chunks: [], consumed: input.byteLength };
    const stream = createDecompressionStream(format, provider);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const first = reader.read();
    const close = assert.rejects(writer.close(), TypeError);
    assert.equal((await first).value, prefix);
    await Promise.all([close, assert.rejects(reader.read(), TypeError)]);
    assert.equal(provider.context.closeCount, 1);
  }
});
