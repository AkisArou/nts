import { coerceToDOMString, requireArguments } from "../core/webidl.ts";
import { currentWebPlatformRuntime, hasWebPlatformRuntime } from "../provider/environment.ts";
import type {
  CompressionContext,
  CompressionFailure,
  CompressionFormat,
  CompressionProvider,
} from "../provider/compression.ts";
import { TransformStream } from "../streams/transform.ts";
import type { Transformer, TransformStreamDefaultController } from "../streams/transform.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { WritableStream } from "../streams/writable.ts";

const constructionKey: unique symbol = Symbol("Compression Streams construction");
const isView = ArrayBuffer.isView;
const emptyBytes = new Uint8Array(0);

/** Bootstrap owns the environment slot; an absent capability has no host fallback. */
function currentCompressionProvider(): CompressionProvider | undefined {
  return hasWebPlatformRuntime() ? currentWebPlatformRuntime().compression : undefined;
}

/** Web IDL enum conversion; format names are case-sensitive. */
function compressionFormat(value: unknown): CompressionFormat {
  const format = coerceToDOMString(value);
  if (format !== "gzip" && format !== "deflate" && format !== "deflate-raw") {
    throw new TypeError("Unsupported compression format");
  }
  return format;
}

/**
 * Compression §§4–5, BufferSource conversion. As in crypto/buffer-source.ts,
 * nts's fixed intrinsic layouts make these plain reads internal slot reads.
 * Detached buffers have no bytes. No copy is observable: the native call finishes
 * before enqueue can invoke script, and the provider cannot retain its input.
 */
function compressionBytes(value: unknown): Uint8Array {
  if (isView(value)) {
    const buffer = value.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.resizable) {
      throw new TypeError("Compression chunks require an ordinary fixed ArrayBuffer");
    }
    if (buffer.detached) return emptyBytes;
    if (value instanceof Uint8Array) return value;
    return new Uint8Array(buffer, value.byteOffset, value.byteLength);
  }
  if (!(value instanceof ArrayBuffer) || value.resizable) {
    throw new TypeError("Compression chunks must be BufferSource values");
  }
  return value.detached ? emptyBytes : new Uint8Array(value);
}

function compressionError(result: CompressionFailure): TypeError {
  return new TypeError("Native compression failed: " + result.failure);
}

/** Both Web interfaces use the same GenericTransformStream and lifetime policy. */
class CompressionTransformer implements Transformer<unknown, Uint8Array> {
  private context: CompressionContext | null;

  constructor(context: CompressionContext) {
    this.context = context;
  }

  transform(chunk: unknown, controller: TransformStreamDefaultController<Uint8Array>): void {
    try {
      const context = this.context;
      if (context === null) throw new TypeError("Compression context is closed");
      const bytes = compressionBytes(chunk);
      const inputLength = bytes.byteLength;
      // The entire borrowed range crosses the capability once, before enqueue.
      const result = context.process(bytes, "none", Infinity);
      if ("failure" in result) throw compressionError(result);
      this.enqueue(result.chunks, controller);
      // Compression §5, decompress-and-enqueue step 6: valid output is observable
      // before a trailing-input error. The provider never starts a second member.
      if (result.consumed !== inputLength) {
        throw new TypeError("Compressed input contains trailing data");
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  flush(controller: TransformStreamDefaultController<Uint8Array>): void {
    try {
      const context = this.context;
      if (context === null) throw new TypeError("Compression context is closed");
      const result = context.process(emptyBytes, "finish", Infinity);
      if ("failure" in result) {
        // Compression §5, decompress-flush steps 2–3: expose available bytes
        // before reporting that the compressed stream never reached its end.
        if (result.failure === "incomplete") this.enqueue(result.chunks, controller);
        throw compressionError(result);
      }
      this.enqueue(result.chunks, controller);
    } finally {
      this.close();
    }
  }

  cancel(): void {
    this.close();
  }

  private enqueue(
    chunks: readonly Uint8Array[],
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    for (const chunk of chunks) {
      if (chunk.byteLength !== 0) controller.enqueue(chunk);
    }
  }

  private close(): void {
    const context = this.context;
    this.context = null;
    context?.close();
  }
}

function compressionTransform(
  format: CompressionFormat,
  provider: CompressionProvider,
  decompress: boolean,
): TransformStream<unknown, Uint8Array> {
  const context = decompress
    ? provider.createDecompressor(format, 15)
    : provider.createCompressor(format, 15);
  if ("failure" in context) throw compressionError(context);
  try {
    return new TransformStream(new CompressionTransformer(context));
  } catch (error) {
    context.close();
    throw error;
  }
}

/** Compression Standard §4, https://compression.spec.whatwg.org/#compressionstream. */
export class CompressionStream {
  readonly #transform: TransformStream<unknown, Uint8Array>;

  constructor(format: unknown, key: symbol | undefined = undefined, provider?: CompressionProvider) {
    requireArguments(arguments, 1, "CompressionStream");
    const normalized = compressionFormat(format);
    // Web IDL converts format before the constructor steps. Extra public
    // arguments cannot replace the environment-owned capability.
    const capability = key === constructionKey ? provider : currentCompressionProvider();
    if (capability === undefined) {
      throw new TypeError("CompressionStream requires an installed compression provider");
    }
    this.#transform = compressionTransform(normalized, capability, false);
  }

  get readable(): ReadableStream<Uint8Array> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<unknown> {
    return this.#transform.writable;
  }

  get [Symbol.toStringTag](): string {
    return "CompressionStream";
  }
}

/** Compression Standard §5, https://compression.spec.whatwg.org/#decompressionstream. */
export class DecompressionStream {
  readonly #transform: TransformStream<unknown, Uint8Array>;

  constructor(format: unknown, key: symbol | undefined = undefined, provider?: CompressionProvider) {
    requireArguments(arguments, 1, "DecompressionStream");
    const normalized = compressionFormat(format);
    const capability = key === constructionKey ? provider : currentCompressionProvider();
    if (capability === undefined) {
      throw new TypeError("DecompressionStream requires an installed compression provider");
    }
    this.#transform = compressionTransform(normalized, capability, true);
  }

  get readable(): ReadableStream<Uint8Array> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<unknown> {
    return this.#transform.writable;
  }

  get [Symbol.toStringTag](): string {
    return "DecompressionStream";
  }
}

/** Internal provider factory; it is not exported by the public Web API barrel. */
export function createCompressionStream(format: unknown, provider: CompressionProvider): CompressionStream {
  return new CompressionStream(format, constructionKey, provider);
}

/** Internal provider factory; it preserves the canonical class's identity. */
export function createDecompressionStream(format: unknown, provider: CompressionProvider): DecompressionStream {
  return new DecompressionStream(format, constructionKey, provider);
}
