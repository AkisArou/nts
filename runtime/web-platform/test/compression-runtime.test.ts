// Compression §§4–5 and Web IDL constructor/enum conversion, exercised through
// the canonical public classes and the existing environment-owned runtime.
// https://compression.spec.whatwg.org/#compressionstream
// https://compression.spec.whatwg.org/#decompressionstream
// https://webidl.spec.whatwg.org/#es-enumeration
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, deflateSync, gzipSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import * as PublicAPI from "../src/index.ts";
import type { CompressionFormat as PublicCompressionFormat } from "../src/index.ts";
import * as ProviderAPI from "../src/provider.ts";
import { currentWebPlatformRuntime, installWebPlatformRuntime, WebPlatformRuntime } from "../src/provider.ts";
import type {
  CompressionContext, CompressionFailure, CompressionFlush, CompressionFormat,
  CompressionProvider, CompressionResult, WebPlatformOptions,
} from "../src/provider.ts";
import { hasWebPlatformRuntime } from "../src/provider/environment.ts";
import {
  CompressionStream as InternalCompressionStream,
  DecompressionStream as InternalDecompressionStream,
  createCompressionStream, createDecompressionStream,
} from "../src/compression/compression-stream.ts";
import { NodeCompressionProvider } from "./node-compression-provider.ts";

class CountingContext implements CompressionContext {
  readonly native: CompressionContext;
  processCalls: number = 0;
  closeCalls: number = 0;

  constructor(native: CompressionContext) { this.native = native; }

  process(input: Uint8Array, flush: CompressionFlush, maximum: number): CompressionResult | CompressionFailure {
    this.processCalls++;
    return this.native.process(input, flush, maximum);
  }

  reset(): void | CompressionFailure { return this.native.reset(); }

  close(): void {
    this.closeCalls++;
    this.native.close();
  }
}

class CountingProvider extends NodeCompressionProvider {
  readonly attempts: { direction: string; format: CompressionFormat; windowBits: number }[] = [];
  readonly contexts: CountingContext[] = [];
  failure: CompressionFailure | undefined;

  override createCompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    this.attempts.push({ direction: "compress", format, windowBits });
    return this.record(this.failure ?? super.createCompressor(format, windowBits));
  }

  override createDecompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    this.attempts.push({ direction: "decompress", format, windowBits });
    return this.record(this.failure ?? super.createDecompressor(format, windowBits));
  }

  private record(result: CompressionContext | CompressionFailure): CompressionContext | CompressionFailure {
    if ("failure" in result) return result;
    const context = new CountingContext(result);
    this.contexts.push(context);
    return context;
  }
}

const formats: readonly PublicCompressionFormat[] = ["gzip", "deflate", "deflate-raw"];
const constructors = [PublicAPI.CompressionStream, PublicAPI.DecompressionStream];
type ByteTransform = PublicAPI.CompressionStream | PublicAPI.DecompressionStream;

function nativeCompress(format: CompressionFormat, input: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return gzipSync(input);
    case "deflate": return deflateSync(input);
    case "deflate-raw": return deflateRawSync(input);
  }
}

function nativeDecompress(format: CompressionFormat, input: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return new Uint8Array(gunzipSync(input));
    case "deflate": return new Uint8Array(inflateSync(input));
    case "deflate-raw": return new Uint8Array(inflateRawSync(input));
  }
}

async function transform(stream: ByteTransform, input: Uint8Array): Promise<Uint8Array> {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const read = (async () => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      assert.ok(result.value instanceof Uint8Array);
      assert.ok(result.value.byteLength > 0);
      chunks.push(result.value);
      length += result.value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  })();
  const write = (async () => {
    await writer.write(input.subarray(0, 2));
    await writer.write(input.subarray(2));
    await writer.close();
  })();
  try {
    const [output] = await Promise.all([read, write]);
    return output;
  } finally {
    reader.releaseLock(); writer.releaseLock();
  }
}

async function withRuntime(provider: CompressionProvider | undefined, run: (runtime: WebPlatformRuntime) => Promise<void>): Promise<void> {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const runtime = new WebPlatformRuntime(createHostNodePrimitives(), { compression: provider });
  installWebPlatformRuntime(runtime);
  try { await run(runtime); }
  finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    runtime.close();
  }
}

test("public compression construction requires an installed runtime while internal factories remain usable", async () => {
  assert.equal(hasWebPlatformRuntime(), false);
  for (const Constructor of constructors) assert.throws(() => new Constructor("gzip"), TypeError);
  const provider = new CountingProvider();
  const compressor = createCompressionStream("gzip", provider);
  const decompressor = createDecompressionStream("gzip", provider);
  assert.equal(compressor.constructor, PublicAPI.CompressionStream);
  assert.equal(decompressor.constructor, PublicAPI.DecompressionStream);
  await Promise.all([compressor.readable.cancel(), decompressor.readable.cancel()]);
  assert.equal(hasWebPlatformRuntime(), false);
});

test("an absent compression capability never falls back to ambient Node constructors or an extra provider argument", async () => {
  assert.equal(typeof globalThis.CompressionStream, "function");
  assert.equal(typeof globalThis.DecompressionStream, "function");
  const injected = new CountingProvider();
  await withRuntime(undefined, async (runtime) => {
    assert.equal(runtime.compression, undefined);
    for (const Constructor of constructors) {
      assert.throws(() => new Constructor("gzip"), TypeError);
      assert.throws(() => new Constructor("gzip", Symbol("guessed token"), injected), TypeError);
    }
  });
  assert.deepEqual(injected.attempts, []);
});

test("runtime construction reads compression once and creates native contexts only for individual streams", async () => {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const provider = new CountingProvider();
  let reads = 0;
  const options: WebPlatformOptions = {
    get compression(): CompressionProvider {
      reads++;
      if (reads !== 1) throw new Error("compression was read twice");
      return provider;
    },
  };
  const runtime = new WebPlatformRuntime(createHostNodePrimitives(), options);
  try {
    assert.equal(runtime.compression, provider);
    assert.equal(reads, 1);
    assert.deepEqual(provider.attempts, []);
    installWebPlatformRuntime(runtime);
    const first = new PublicAPI.CompressionStream("gzip");
    const second = new PublicAPI.CompressionStream("gzip");
    assert.equal(reads, 1);
    assert.equal(provider.contexts.length, 2);
    assert.notEqual(provider.contexts[0], provider.contexts[1]);
    assert.notEqual(first.readable, second.readable);
    assert.notEqual(first.writable, second.writable);
    await Promise.all([first.readable.cancel(), second.readable.cancel()]);
    for (const context of provider.contexts) assert.equal(context.closeCalls, 1);
  } finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    runtime.close();
  }
});

for (const format of formats) {
  test("public " + format + " constructors use the installed native capability in both directions", async () => {
    const provider = new CountingProvider();
    const input = new Uint8Array([0, 255, 42, 42, 42, 42, 128, 7, 0, 9, 10]);
    await withRuntime(provider, async () => {
      const compressed = await transform(new PublicAPI.CompressionStream(format), input);
      assert.deepEqual(nativeDecompress(format, compressed), input);
      const decompressed = await transform(new PublicAPI.DecompressionStream(format), nativeCompress(format, input));
      assert.deepEqual(decompressed, input);
      assert.deepEqual(provider.attempts, [
        { direction: "compress", format, windowBits: 15 },
        { direction: "decompress", format, windowBits: 15 },
      ]);
      for (const context of provider.contexts) {
        assert.equal(context.processCalls, 3);
        assert.equal(context.closeCalls, 1);
      }
    });
  });
}

test("public compression exports preserve canonical identities and keep native factories internal", async () => {
  assert.equal(PublicAPI.CompressionStream, InternalCompressionStream);
  assert.equal(PublicAPI.DecompressionStream, InternalDecompressionStream);
  for (const name of ["createCompressionStream", "createDecompressionStream", "CompressionProvider", "CompressionContext", "CompressionFailure", "CompressionResult", "CompressionFlush", "CompressionFormat"]) {
    assert.equal(name in PublicAPI, false, name);
    assert.equal(name in ProviderAPI, false, name);
  }
  for (const name of ["CompressionStream", "DecompressionStream"]) assert.equal(name in ProviderAPI, false, name);
  await withRuntime(new CountingProvider(), async () => {
    class DerivedCompressor extends PublicAPI.CompressionStream {}
    class DerivedDecompressor extends PublicAPI.DecompressionStream {}
    for (const [stream, Constructor, tag] of [
      [new DerivedCompressor("gzip"), PublicAPI.CompressionStream, "CompressionStream"],
      [new DerivedDecompressor("gzip"), PublicAPI.DecompressionStream, "DecompressionStream"],
    ] as const) {
      assert.ok(stream instanceof Constructor);
      assert.ok(stream.readable instanceof PublicAPI.ReadableStream);
      assert.ok(stream.writable instanceof PublicAPI.WritableStream);
      assert.equal(stream.readable, stream.readable);
      assert.equal(stream.writable, stream.writable);
      assert.equal(stream[Symbol.toStringTag], tag);
      await stream.readable.cancel();
    }
  });
});

test("runtime replacement and option mutation do not retarget existing compression contexts", async () => {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const first = new CountingProvider();
  const second = new CountingProvider();
  const options: WebPlatformOptions = { compression: first };
  const firstRuntime = new WebPlatformRuntime(createHostNodePrimitives(), options);
  const secondRuntime = new WebPlatformRuntime(createHostNodePrimitives(), { compression: second });
  const input = new Uint8Array([1, 2, 3, 4, 5]);
  try {
    installWebPlatformRuntime(firstRuntime);
    const originalCompressor = new PublicAPI.CompressionStream("gzip");
    const originalDecompressor = new PublicAPI.DecompressionStream("gzip");
    options.compression = second;
    installWebPlatformRuntime(secondRuntime);
    const replacement = new PublicAPI.CompressionStream("deflate");
    installWebPlatformRuntime(firstRuntime);
    const laterFirst = new PublicAPI.CompressionStream("deflate-raw");
    installWebPlatformRuntime(secondRuntime);
    const outputs = await Promise.all([
      transform(originalCompressor, input),
      transform(originalDecompressor, gzipSync(input)),
      transform(replacement, input),
      transform(laterFirst, input),
    ]);
    assert.deepEqual(nativeDecompress("gzip", outputs[0]!), input);
    assert.deepEqual(outputs[1], input);
    assert.deepEqual(nativeDecompress("deflate", outputs[2]!), input);
    assert.deepEqual(nativeDecompress("deflate-raw", outputs[3]!), input);
    assert.equal(firstRuntime.compression, first);
    assert.equal(first.contexts.length, 3);
    assert.equal(second.contexts.length, 1);
    for (const context of [...first.contexts, ...second.contexts]) {
      assert.equal(context.processCalls, 3);
      assert.equal(context.closeCalls, 1);
    }
  } finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    firstRuntime.close(); secondRuntime.close();
  }
});

test("public compression converts the format before selecting the current runtime", async () => {
  const first = new CountingProvider();
  const second = new CountingProvider();
  const secondRuntime = new WebPlatformRuntime(createHostNodePrimitives(), { compression: second });
  try {
    await withRuntime(first, async (firstRuntime) => {
      for (const Constructor of constructors) {
        installWebPlatformRuntime(firstRuntime);
        let conversions = 0;
        const stream = new Constructor({
          toString(): string {
            conversions++;
            installWebPlatformRuntime(secondRuntime);
            return "gzip";
          },
        });
        assert.equal(conversions, 1);
        await stream.readable.cancel();
      }
      assert.deepEqual(first.attempts, []);
      assert.equal(second.contexts.length, 2);
    });
  } finally { secondRuntime.close(); }
});

test("public compression preserves format-conversion exceptions and rejects invalid arguments before native creation", async () => {
  const provider = new CountingProvider();
  await withRuntime(provider, async () => {
    for (const Constructor of constructors) {
      // @ts-expect-error Missing the required Web IDL argument.
      assert.throws(() => new Constructor(), TypeError);
      for (const value of [undefined, null, "GZIP", "brotli", Symbol("gzip")]) {
        assert.throws(() => new Constructor(value), TypeError);
      }
      const sentinel = new Error("format conversion failed");
      assert.throws(() => new Constructor({ toString() { throw sentinel; } }), (error: unknown) => error === sentinel);
    }
    assert.deepEqual(provider.attempts, []);
  });
});

test("public compression ignores extra constructor arguments instead of accepting injected capabilities", async () => {
  const provider = new CountingProvider();
  const injected = new CountingProvider();
  injected.failure = { failure: "operation" };
  await withRuntime(provider, async () => {
    for (const Constructor of constructors) {
      for (const key of [undefined, Symbol("Compression Streams construction")]) {
        const stream = new Constructor("gzip", key, injected);
        await stream.readable.cancel();
      }
    }
    assert.equal(provider.contexts.length, 4);
    assert.deepEqual(injected.attempts, []);
  });
});

test("public compression maps native creation failure values to TypeError", async () => {
  const provider = new CountingProvider();
  await withRuntime(provider, async () => {
    for (const failure of ["unsupported", "operation"] as const) {
      provider.failure = { failure };
      for (const Constructor of constructors) assert.throws(() => new Constructor("gzip"), TypeError);
    }
    assert.equal(provider.attempts.length, 4);
    assert.deepEqual(provider.contexts, []);
  });
});

test("the Node host helper forwards compression without supplying an ambient default", async () => {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : undefined;
  const provider = new CountingProvider();
  const absent = createHostNodeWebPlatform();
  try {
    assert.equal(absent.compression, undefined);
    assert.throws(() => new PublicAPI.CompressionStream("gzip"), TypeError);
    const enabled = createHostNodeWebPlatform({ compression: provider });
    try {
      assert.equal(currentWebPlatformRuntime(), enabled);
      assert.equal(enabled.compression, provider);
      const stream = new PublicAPI.CompressionStream("gzip");
      await stream.readable.cancel();
      assert.equal(provider.contexts.length, 1);
    } finally { enabled.close(); }
  } finally {
    if (previous !== undefined) installWebPlatformRuntime(previous);
    absent.close();
  }
});
