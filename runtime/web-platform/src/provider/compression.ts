/**
 * Synchronous native compression below the shared Web API and protocol policy.
 * https://compression.spec.whatwg.org/#supported-formats
 * https://www.rfc-editor.org/rfc/rfc7932#section-1.4
 * https://www.rfc-editor.org/rfc/rfc7692#section-7.2
 *
 * Brotli, DEFLATE, gzip/zlib framing, header parsing and checksums are native
 * work. No primitive here invokes script, schedules work or throws into TypeScript.
 * Failures are values; the shared caller selects its specified exception.
 *
 * A process call borrows the complete input until it returns, without retaining
 * or mutating it. It consumes the input up to the first stream end. Native
 * code drains its output internally: there is no per-byte or per-block FFI.
 * Each result transfers fresh, nonempty Uint8Array chunks backed by ordinary
 * ArrayBuffers, without aliases to inputs, previous results or provider scratch
 * memory. An empty result has no chunks. Output is never reused after return.
 *
 * Contexts are opaque provider-owned state, with one caller and no concurrent
 * operations. Their native resources follow object lifetime as a final backstop;
 * close releases them promptly and is idempotent. No numeric native pointers
 * enter the shared layer.
 */

export type CompressionFormat = "gzip" | "deflate" | "deflate-raw" | "brotli";
export type CompressionFlush = "none" | "sync" | "finish";

export type CompressionFailure =
  | { readonly failure: "invalid-data" | "output-limit" | "unsupported" | "operation" }
  | {
      /** Finish reached an incomplete stream after producing these valid bytes. */
      readonly failure: "incomplete";
      readonly chunks: readonly Uint8Array[];
    };

export interface CompressionResult {
  readonly chunks: readonly Uint8Array[];
  /**
   * Input bytes consumed. Less than input.byteLength only at a decompressor's
   * first stream end, never for output-buffer exhaustion. Compression §5
   * enqueues the valid output before rejecting the unconsumed trailing bytes.
   */
  readonly consumed: number;
}

export interface CompressionContext {
  /**
   * `none` consumes input without forcing an output boundary. `sync` drains the
   * format's native synchronous flush while retaining its context. For DEFLATE
   * this is byte-aligned, including the RFC 7692 00 00 ff ff tail for raw
   * compression; shared WebSocket code removes or supplies that tail. Brotli
   * uses its native flush operation without a DEFLATE tail. `finish` completes
   * the native stream, including its format trailer where applicable, and
   * verifies its end. Decompressors reject an incomplete stream on finish, even
   * when the input is empty.
   *
   * All decompression formats stop at their first completed stream. Any bytes
   * after it remain unconsumed, in this call or a later one; shared policy
   * enqueues the returned output, then rejects that trailing input. Gzip
   * accepts exactly one member, validates
   * FHCRC when present, CRC32 and ISIZE, and rejects malformed optional fields.
   * Zlib validates ADLER32 and rejects FDICT. Brotli validates RFC 7932 blocks
   * and rejects nonconforming extensions. This is stricter than libraries
   * which accept concatenated gzip or ignore unused input. Empty writes after
   * native stream end remain valid until finish. Raw sync flush does not demand
   * BFINAL; raw finish does.
   *
   * `maxOutputBytes` is a nonnegative safe integer or Infinity, and bounds the
   * sum of this call's output. The provider enforces it while producing output,
   * before retaining an unbounded result; it may probe one extra byte to detect
   * overflow. A failure is terminal and permits only close; all failures discard
   * this call's output except `incomplete`, which carries bytes to enqueue
   * before the finish error (Compression §5). Successful finish permits only
   * reset/close. A caller requiring recovery creates a fresh context.
   */
  process(
    input: Uint8Array,
    flush: CompressionFlush,
    maxOutputBytes: number,
  ): CompressionResult | CompressionFailure;

  /** Reset format, checksum, dictionary and terminal state to a fresh context. */
  reset(): void | CompressionFailure;

  /** Release resources without throwing; repeated close is harmless. */
  close(): void;
}

/**
 * One capability for Compression Streams and RFC 7692 permessage-deflate.
 * The Web surface selects windowBits=15. This setting applies only to DEFLATE
 * formats and is ignored for Brotli, whose native implementation selects an
 * RFC 7932-compliant window. Protocol negotiation may request 8..15 for raw
 * DEFLATE; unsupported window sizes must fail, never silently increase the
 * negotiated window. A caller can offer only supported settings.
 *
 * The DEFLATE formats are implementable with zlib and JDK Deflater/Inflater.
 * The JDK's fixed window may report unsupported for smaller windows. Brotli
 * requires a native RFC 7932 implementation. Gzip wrapping and validation belong
 * to the native binding, using its native checksum classes, and never move into
 * shared TypeScript when a library lacks a wrapper.
 * Compression settings other than the format and negotiated window are native
 * choices: the Web API promises valid output, not one particular encoding.
 */
export interface CompressionProvider {
  createCompressor(
    format: CompressionFormat,
    windowBits: number,
  ): CompressionContext | CompressionFailure;

  createDecompressor(
    format: CompressionFormat,
    windowBits: number,
  ): CompressionContext | CompressionFailure;
}
