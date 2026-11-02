import {
  nts_web_compression_open,
  nts_web_compression_process,
  nts_web_compression_status,
  nts_web_compression_consumed,
  nts_web_compression_reset,
  nts_web_compression_close,
} from "c:nts_web_compression";
import type { NativeCompressionHandle } from "./handle.ts";
import type {
  CompressionContext, CompressionFailure, CompressionFlush, CompressionFormat,
  CompressionProvider, CompressionResult,
} from "../../../src/provider/compression.ts";

class NativeCompressionContext implements CompressionContext {
  readonly #handle: NativeCompressionHandle;

  constructor(handle: NativeCompressionHandle) {
    this.#handle = handle;
  }

  process(input: Uint8Array, flush: CompressionFlush,
    maxOutputBytes: number): CompressionResult | CompressionFailure {
    if (maxOutputBytes !== Infinity &&
        (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0)) {
      this.close();
      return { failure: "operation" };
    }
    const chunks = nts_web_compression_process(this.#handle, input,
      flush === "none" ? 0 : flush === "sync" ? 1 : 2, maxOutputBytes);
    const status = nts_web_compression_status(this.#handle);
    if (status === 1) return { failure: "invalid-data" };
    if (status === 2) return { failure: "output-limit" };
    if (status === 3) return { failure: "incomplete", chunks };
    if (status !== 0) return { failure: "operation" };
    return { chunks, consumed: nts_web_compression_consumed(this.#handle) };
  }

  reset(): void | CompressionFailure {
    if (!nts_web_compression_reset(this.#handle)) return { failure: "operation" };
  }

  close(): void {
    nts_web_compression_close(this.#handle);
  }
}

/** Bulk synchronous codecs from the compiler's bundled native libraries. */
export class NativeCompressionProvider implements CompressionProvider {
  createCompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    return this.create(format, windowBits, false);
  }

  createDecompressor(format: CompressionFormat, windowBits: number): CompressionContext | CompressionFailure {
    return this.create(format, windowBits, true);
  }

  private create(format: CompressionFormat, windowBits: number,
    decompress: boolean): CompressionContext | CompressionFailure {
    // zlib promotes an 8-bit compressor window to 9. Decline it rather than
    // violate a protocol's negotiated bound. Brotli does not use windowBits.
    if (format !== "brotli" && (!Number.isInteger(windowBits) ||
        windowBits < (decompress ? 8 : 9) || windowBits > 15)) {
      return { failure: "unsupported" };
    }
    const kind = format === "brotli" ? 0 : format === "gzip" ? 1 :
      format === "deflate" ? 2 : 3;
    const handle = nts_web_compression_open(kind, decompress, windowBits);
    return handle === null ? { failure: "operation" } : new NativeCompressionContext(handle);
  }
}
