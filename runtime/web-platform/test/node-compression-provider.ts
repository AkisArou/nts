import {
  constants,
  createDeflate,
  createDeflateRaw,
  createGunzip,
  createGzip,
  createInflate,
  createInflateRaw,
} from "node:zlib";
import type { Deflate, ZlibOptions } from "node:zlib";
import type {
  CompressionContext,
  CompressionFailure,
  CompressionFlush,
  CompressionFormat,
  CompressionProvider,
  CompressionResult,
} from "../src/provider/compression.ts";

/**
 * The test adapter uses node:zlib's synchronous native streaming entry point.
 * Public sync convenience methods finish and close their context on every call;
 * retaining one native handle instead exercises chunking and dictionary history.
 * These fields are Node's test-host seam, never part of the shared runtime.
 *
 * Node 24.20.0 (the repository pin) provides rejectGarbageAfterEnd to prevent its
 * native gunzip wrapper from automatically consuming a second gzip member.
 * https://github.com/nodejs/node/blob/v24.20.0/lib/zlib.js
 * https://github.com/nodejs/node/blob/v24.20.0/src/node_zlib.cc
 */
interface NativeZlibHandle {
  onerror: (message: string, errno: number, code: string) => void;
  writeSync(
    flush: number,
    input: Uint8Array,
    inputOffset: number,
    inputLength: number,
    output: Uint8Array,
    outputOffset: number,
    outputLength: number,
  ): void;
}

interface NativeZlibStream extends Deflate {
  readonly _handle: NativeZlibHandle | null;
  readonly _writeState: Uint32Array;
}

interface StrictZlibOptions extends ZlibOptions {
  readonly rejectGarbageAfterEnd: true;
}

const outputBlockSize = 16 * 1024;

class NodeCompressionContext implements CompressionContext {
  private readonly stream: NativeZlibStream;
  private readonly decompress: boolean;
  private scratch: Uint8Array = new Uint8Array(outputBlockSize);
  private error: CompressionFailure | null = null;
  private nativeErrno: number | null = null;
  private closed: boolean = false;
  private finished: boolean = false;

  constructor(stream: NativeZlibStream, decompress: boolean) {
    this.stream = stream;
    this.decompress = decompress;
    const handle = stream._handle;
    if (handle === null) throw new Error("node:zlib did not create a native context");
    // writeSync invokes this callback synchronously. Replacing Node's default
    // event-emitting callback keeps native errors as values at the capability.
    handle.onerror = (_message, errno, _code) => {
      this.nativeErrno = errno;
      this.error = {
        failure: errno === constants.Z_DATA_ERROR ||
          errno === constants.Z_NEED_DICT || errno === constants.Z_BUF_ERROR
          ? "invalid-data"
          : "operation",
      };
    };
  }

  process(
    input: Uint8Array,
    flush: CompressionFlush,
    maxOutputBytes: number,
  ): CompressionResult | CompressionFailure {
    if (this.closed || this.finished) return { failure: "operation" };
    if (maxOutputBytes !== Infinity &&
        (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0)) {
      return this.fail({ failure: "operation" });
    }
    const handle = this.stream._handle;
    if (handle === null) return this.fail({ failure: "operation" });
    const drainBeforeFinish = this.decompress && flush === "finish";
    let flag = flush === "none" || drainBeforeFinish ? constants.Z_NO_FLUSH :
      flush === "sync" ? constants.Z_SYNC_FLUSH : constants.Z_FINISH;
    let finishing = false;
    const chunks: Uint8Array[] = [];
    let outputBytes = 0;
    let offset = 0;
    let remaining = input.byteLength;

    try {
      while (true) {
        // Allow at most one byte beyond the budget to detect overflow. A full
        // scratch block transfers directly; only a short final block is copied.
        const output = this.scratch;
        const outputCapacity = Math.min(output.length, maxOutputBytes - outputBytes + 1);
        handle.writeSync(flag, input, offset, remaining, output, 0, outputCapacity);
        if (this.error !== null) {
          if (finishing && this.nativeErrno === constants.Z_BUF_ERROR) {
            return this.fail({ failure: "incomplete", chunks });
          }
          return this.fail(this.error);
        }
        const availableOutput = this.stream._writeState[0];
        const availableInput = this.stream._writeState[1];
        if (availableOutput === undefined || availableInput === undefined ||
            availableOutput > outputCapacity || availableInput > remaining) {
          return this.fail({ failure: "operation" });
        }
        const produced = outputCapacity - availableOutput;
        if (produced > maxOutputBytes - outputBytes) {
          return this.fail({ failure: "output-limit" });
        }
        if (produced !== 0) {
          if (produced === output.length) {
            chunks.push(output);
            this.scratch = new Uint8Array(outputBlockSize);
          } else {
            chunks.push(output.slice(0, produced));
          }
          outputBytes += produced;
        }
        offset += remaining - availableInput;
        remaining = availableInput;
        if (availableOutput !== 0) {
          // The shared algorithm enqueues this output before rejecting unused
          // trailing bytes, as Compression Standard section 5 step 6 requires.
          if (remaining !== 0) return { chunks, consumed: offset };
          if (drainBeforeFinish && !finishing) {
            // Node does not update its write offsets on a FINISH error. Drain
            // available output first so an incomplete stream can return it to
            // the shared flush algorithm before that algorithm raises TypeError.
            finishing = true;
            flag = constants.Z_FINISH;
            continue;
          }
          if (flush === "finish") this.finished = true;
          return { chunks, consumed: offset };
        }
      }
    } catch {
      return this.fail({ failure: "operation" });
    }
  }

  reset(): void | CompressionFailure {
    if (this.closed) return { failure: "operation" };
    try {
      this.error = null;
      this.nativeErrno = null;
      this.stream.reset();
      if (this.error !== null) return this.fail(this.error);
      this.finished = false;
    } catch {
      return this.fail({ failure: "operation" });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.close();
    } catch {
      // Cleanup is terminal and idempotent, including after a native failure.
    }
  }

  private fail(error: CompressionFailure): CompressionFailure {
    this.close();
    return error;
  }
}

export class NodeCompressionProvider implements CompressionProvider {
  createCompressor(
    format: CompressionFormat,
    windowBits: number,
  ): CompressionContext | CompressionFailure {
    // zlib silently promotes an 8-bit compressor window to 9; an RFC 7692
    // provider must decline that request instead of violating the negotiated cap.
    if (!Number.isInteger(windowBits) || windowBits < 9 || windowBits > 15) {
      return { failure: "unsupported" };
    }
    const options: StrictZlibOptions = { windowBits, rejectGarbageAfterEnd: true };
    try {
      switch (format) {
        case "gzip": return new NodeCompressionContext(createGzip(options) as NativeZlibStream, false);
        case "deflate": return new NodeCompressionContext(createDeflate(options) as NativeZlibStream, false);
        case "deflate-raw": return new NodeCompressionContext(createDeflateRaw(options) as NativeZlibStream, false);
      }
    } catch {
      return { failure: "operation" };
    }
  }

  createDecompressor(
    format: CompressionFormat,
    windowBits: number,
  ): CompressionContext | CompressionFailure {
    if (!Number.isInteger(windowBits) || windowBits < 8 || windowBits > 15) {
      return { failure: "unsupported" };
    }
    const options: StrictZlibOptions = { windowBits, rejectGarbageAfterEnd: true };
    try {
      switch (format) {
        case "gzip": return new NodeCompressionContext(createGunzip(options) as NativeZlibStream, true);
        case "deflate": return new NodeCompressionContext(createInflate(options) as NativeZlibStream, true);
        case "deflate-raw": return new NodeCompressionContext(createInflateRaw(options) as NativeZlibStream, true);
      }
    } catch {
      return { failure: "operation" };
    }
  }
}
