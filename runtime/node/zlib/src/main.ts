// `node:zlib`, from node v24.20.0 `lib/zlib.js`.
//
// Compression is a C library — zlib, brotli, zstd — and what is here is
// everything around it: the option validation, the flush semantics, the stream
// integration, the error codes and the one-shot convenience forms. The same
// division as `node:fs`, where the system call is the kernel's and the module
// is the argument handling.
//
// The flush flag is the part worth understanding. A compressor is allowed to
// hold input back — that is how it finds matches — so nothing is guaranteed to
// come out until it is told to flush. `Z_NO_FLUSH` compresses best and may
// emit nothing at all for a small chunk; `Z_SYNC_FLUSH` ends the current block
// so the reader can see everything so far, at the cost of a few bytes of
// framing; `Z_FINISH` ends the stream. A caller who wants a compressed stream
// to be usable incrementally — a live log, a protocol — has to ask, and
// getting this wrong looks like a stream that never delivers.

import { Buffer } from "../../buffer/src/main.ts";
import { Transform } from "../../stream/src/main.ts";
import { finished } from "../../stream/src/main.ts";
import type { TransformOptions } from "../../stream/src/transform.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_BUFFER_TOO_LARGE,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
  ERR_TRAILING_JUNK_AFTER_STREAM_END,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateFunction,
  validateInteger,
} from "../../internal/validators.ts";
import * as C from "./constants.ts";
import { byteView, optionalByteView, parameterArrays } from "./options.ts";
export * as iter from "./iter.ts";

export * as constants from "./constants.ts";
export { codes } from "./constants.ts";

export type BinaryInput =
  | ArrayBuffer
  | SharedArrayBuffer
  | ArrayBufferView<ArrayBufferLike>;

/**
 * `flush` means two different things and both are spelled the same.
 *
 * `Transform`'s `flush` is the hook called at the end of the stream; zlib's is
 * a numeric flush mode. Node passes the whole options object through to
 * `Transform`, which ignores the number because it checks
 * `typeof flush === "function"` -- benign, and only because JavaScript let the
 * collision happen unnoticed. The stream option is omitted here so the two
 * cannot be confused, and the stream options are built explicitly below rather
 * than spread.
 */
export interface ZlibOptions extends Omit<TransformOptions, "flush" | "transform"> {
  flush?: number | undefined;
  finishFlush?: number | undefined;
  chunkSize?: number | undefined;
  windowBits?: number | undefined;
  level?: number | undefined;
  memLevel?: number | undefined;
  strategy?: number | undefined;
  dictionary?: BinaryInput | undefined;
  info?: boolean | undefined;
  maxOutputLength?: number | undefined;
  params?: Readonly<Record<number, number | boolean>> | undefined;
  pledgedSrcSize?: number | undefined;
  rejectGarbageAfterEnd?: boolean | undefined;
}

/** A number in range, or the default if it was not given at all. */
function finiteOrDefault(value: unknown, name: string, byDefault: number): number {
  if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
    return byDefault;
  }
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isFinite(value)) {
    throw new ERR_OUT_OF_RANGE(name, "a finite number", value);
  }
  return value;
}

function inRangeOrDefault(
  value: unknown,
  name: string,
  min: number,
  max: number,
  byDefault: number,
): number {
  const number = finiteOrDefault(value, name, byDefault);
  if (number < min || number > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, number);
  }
  return number;
}

function minimumOrDefault(
  value: unknown,
  name: string,
  minimum: number,
  byDefault: number,
): number {
  const number = finiteOrDefault(value, name, byDefault);
  if (number < minimum) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${minimum}`, number);
  }
  return number;
}

function rejectGarbageAfterEnd(options?: ZlibOptions): boolean {
  const value = options?.rejectGarbageAfterEnd;
  if (value === undefined) return false;
  validateBoolean(value, "options.rejectGarbageAfterEnd");
  return value;
}

/** A `zlib` failure, carrying the library's own code and name. */
export class ZlibError extends Error {
  errno: number;
  code: string;

  constructor(message: string, errno: number, nativeCode = "") {
    super(message);
    this.errno = errno;
    const fallbackCode = C.codes[String(errno)];
    this.code = nativeCode ||
      (typeof fallbackCode === "string" ? fallbackCode : "Z_UNKNOWN");
    this.name = "Error";
  }
}

/** Numeric flush requests queued behind earlier writes, keyed by their marker. */
const flushFlags = new Map<Uint8Array, number>();

type FlushFamily = "zlib" | "brotli" | "zstd";

interface FlushDefaults {
  readonly flush: number;
  readonly finishFlush: number;
  readonly fullFlush: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly family: FlushFamily;
}

function zlibFlushStrength(flush: number): number {
  switch (flush) {
    case C.Z_NO_FLUSH: return 0;
    case C.Z_BLOCK: return 1;
    case C.Z_PARTIAL_FLUSH: return 2;
    case C.Z_SYNC_FLUSH: return 3;
    case C.Z_FULL_FLUSH: return 4;
    case C.Z_FINISH: return 5;
    default: return -1;
  }
}

function finalFlush(current: number, finishing: number, family: FlushFamily): number {
  if (family !== "zlib") return Math.max(current, finishing);
  return zlibFlushStrength(current) > zlibFlushStrength(finishing)
    ? current
    : finishing;
}

/**
 * Typed control surface for the native engine.
 *
 * Node exposes `_handle` even though it is internal, and its regression suite
 * calls `_handle.reset()` directly. Keeping the numeric ABI identifier inside
 * this fixed-layout value preserves that behavior without treating a number
 * as if it had methods. Hot writes read `identifier` once before crossing the
 * native boundary; reset, parameter changes, and close are cold control paths.
 */
class ZlibNativeHandle {
  readonly identifier: number;

  constructor(identifier: number) {
    this.identifier = identifier;
  }

  reset(): void {
    nts_zlib_reset(this.identifier);
  }

  setParameters(level: number, strategy: number): void {
    nts_zlib_params(this.identifier, level, strategy);
  }

  close(): void {
    nts_zlib_close(this.identifier);
  }
}

interface PausedNativeWrite {
  readonly handle: number;
  readonly flush: number;
  readonly callback: (error?: unknown) => void;
}

const emptyNativeInput = new Uint8Array(0);

/**
 * The stream every compressor and decompressor is.
 *
 * A `Transform`, because that is exactly what compression is: bytes in, other
 * bytes out, with the stream's backpressure deciding how fast. The engine
 * holding input back is why `_flush` matters — at the end of the input there
 * may still be a block's worth of data inside the library.
 */
export class ZlibBase extends Transform {
  bytesWritten = 0;
  _handle: ZlibNativeHandle | null;
  _chunkSize: number;
  _defaultFlushFlag: number;
  _finishFlushFlag: number;
  _defaultFullFlushFlag: number;
  _flushMinimum: number;
  _flushMaximum: number;
  _flushFamily: FlushFamily;
  _maxOutputLength: number;
  _info: boolean;
  #closed = false;
  #outputBytes = 0;
  #pausedWrite: PausedNativeWrite | null = null;

  constructor(
    options: ZlibOptions | undefined,
    handle: number,
    defaults: FlushDefaults,
  ) {
    const chunkSize = minimumOrDefault(
      options?.chunkSize,
      "options.chunkSize",
      C.Z_MIN_CHUNK,
      C.Z_DEFAULT_CHUNK,
    );

    // Built rather than spread: only the stream's own options cross over, so
    // zlib's numeric `flush` cannot be mistaken for the stream's hook of the
    // same name. A compressor's output is bytes and only bytes, so the
    // object-mode and encoding options are dropped -- node clears them rather
    // than refusing them, because they are usually inherited from a wider
    // options object the caller passed to several things.
    super({
      autoDestroy: options?.autoDestroy ?? true,
      emitClose: options?.emitClose,
      highWaterMark: options?.highWaterMark,
      signal: options?.signal,
      encoding: undefined,
      objectMode: false,
      writableObjectMode: false,
    });

    this._handle = new ZlibNativeHandle(handle);
    this._chunkSize = chunkSize;
    this._defaultFlushFlag = inRangeOrDefault(
      options?.flush,
      "options.flush",
      defaults.minimum,
      defaults.maximum,
      defaults.flush,
    );
    this._finishFlushFlag = inRangeOrDefault(
      options?.finishFlush,
      "options.finishFlush",
      defaults.minimum,
      defaults.maximum,
      defaults.finishFlush,
    );
    this._defaultFullFlushFlag = defaults.fullFlush;
    this._flushMinimum = defaults.minimum;
    this._flushMaximum = defaults.maximum;
    this._flushFamily = defaults.family;
    this._maxOutputLength = inRangeOrDefault(
      options?.maxOutputLength,
      "options.maxOutputLength",
      1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
    this._info = Boolean(options?.info);
  }

  /** Whether the engine has been released. */
  get _closed(): boolean {
    return this._handle === null;
  }

  override _transform(chunk: unknown, _encoding: string, callback: (error?: unknown) => void): void {
    const input = asBytes(chunk, "chunk");
    const requestedFlush = flushFlags.get(input);
    if (requestedFlush !== undefined) flushFlags.delete(input);
    // The last chunk also carries the finishing flush, or the engine would
    // keep its final block and the output would be truncated.
    const isLast = this.writableEnded && this.writableLength === input.byteLength;
    const flush = requestedFlush ?? (isLast
      ? finalFlush(this._defaultFlushFlag, this._finishFlushFlag, this._flushFamily)
      : this._defaultFlushFlag);
    this.#run(input, flush, callback);
  }

  override _flush(callback: (error?: unknown) => void): void {
    // Whatever the engine is still holding.
    this.#run(Buffer.alloc(0), this._finishFlushFlag, callback);
  }

  override _read(): void {
    super._read();
    const paused = this.#pausedWrite;
    if (paused === null) return;
    this.#pausedWrite = null;
    this.#runAsync(
      paused.handle,
      emptyNativeInput,
      paused.flush,
      paused.callback,
    );
  }

  _processChunk(chunk: unknown, flush: number): Buffer;
  _processChunk(
    chunk: unknown,
    flush: number,
    callback: (error?: unknown) => void,
  ): void;
  _processChunk(
    chunk: unknown,
    flush: number,
    callback?: (error?: unknown) => void,
  ): Buffer | void {
    const input = asBytes(chunk, "chunk");
    const handle = this._handle;
    if (callback !== undefined) {
      if (handle === null) {
        nextTick(callback);
      } else {
        this.bytesWritten += input.byteLength;
        this.#runAsync(handle.identifier, input, flush, callback);
      }
      return;
    }
    if (handle === null) throw new Error("zlib binding closed");

    const output = nts_zlib_write_sync(
      handle.identifier,
      flush,
      input,
      this._maxOutputLength,
    );
    const status = nts_zlib_status(handle.identifier);
    if (status !== 0) {
      throw new ZlibError(
        nts_zlib_error_message(handle.identifier),
        status,
        nts_zlib_error_code(handle.identifier),
      );
    }
    if (output.byteLength > this._maxOutputLength) {
      throw new RangeError(`Cannot create a Buffer larger than ${this._maxOutputLength} bytes`);
    }
    this.bytesWritten += input.byteLength;
    handle.close();
    this._handle = null;
    return Buffer.from(output);
  }

  #run(chunk: Uint8Array, flush: number, callback: (error?: unknown) => void): void {
    if (this._handle === null) {
      nextTick(callback);
      return;
    }
    const handle = this._handle.identifier;
    this.bytesWritten += chunk.length;
    this.#runAsync(handle, chunk, flush, callback);
  }

  async #runAsync(
    handle: number,
    chunk: Uint8Array,
    flush: number,
    callback: (error?: unknown) => void,
  ): Promise<void> {
    let input = chunk;
    while (true) {
      let output: Uint8Array;
      try {
        const remainingOutput = this._maxOutputLength - this.#outputBytes;
        const outputLimit = Math.min(this._chunkSize, remainingOutput + 1);
        output = await nts_zlib_write(handle, flush, input, outputLimit);
      } catch (error) {
        callback(error);
        return;
      }

      // Destroying a stream closes its native handle. A write already running
      // in libuv is allowed to finish, but its result no longer belongs to a
      // live Transform and the handle may have been released before this
      // continuation runs.
      if (this.#closed) {
        callback();
        return;
      }

      const status = nts_zlib_status(handle);
      if (status !== 0) {
        const code = nts_zlib_error_code(handle);
        callback(code === "ERR_TRAILING_JUNK_AFTER_STREAM_END"
          ? new ERR_TRAILING_JUNK_AFTER_STREAM_END()
          : new ZlibError(nts_zlib_error_message(handle), status, code));
        return;
      }
      this.bytesWritten = nts_zlib_bytes_written(handle);
      this.#outputBytes += output.byteLength;
      if (this.#outputBytes > this._maxOutputLength) {
        callback(new ERR_BUFFER_TOO_LARGE(this._maxOutputLength));
        return;
      }

      const canContinue = output.byteLength === 0 || this.push(Buffer.from(output));
      if (!nts_zlib_operation_pending(handle)) {
        if (nts_zlib_stream_ended(handle)) this.push(null);
        callback();
        return;
      }
      if (!canContinue) {
        this.#pausedWrite = { handle, flush, callback };
        return;
      }
      input = emptyNativeInput;
    }
  }

  /**
   * End the current block so the reader can see everything written so far.
   *
   * Written as a zero-length chunk carrying the flag rather than acting
   * directly, so that a flush requested while writes are queued happens
   * *after* them. Flushing immediately would reorder the stream.
   */
  flush(kind?: number | (() => void), callback?: () => void): void {
    if (typeof kind === "function") {
      callback = kind;
      kind = this._defaultFullFlushFlag;
    }

    const validatedKind = inRangeOrDefault(
      kind,
      "kind",
      this._flushMinimum,
      this._flushMaximum,
      this._defaultFullFlushFlag,
    );

    if (this.writableFinished) {
      if (callback) nextTick(callback);
    } else if (this.writableEnded) {
      if (callback) this.once("end", callback);
    } else {
      const marker = Buffer.alloc(0);
      flushFlags.set(marker, validatedKind);
      this.write(marker, undefined, callback);
    }
  }

  /** Forget everything and start a new stream on the same engine. */
  reset(): void {
    if (this._handle === null) throw new Error("zlib binding closed");
    this._handle.reset();
  }

  close(callback?: () => void): void {
    if (callback) finished(this, callback);
    this.destroy();
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    this.#pausedWrite = null;
    if (!this.#closed && this._handle !== null) {
      this.#closed = true;
      this._handle.close();
      this._handle = null;
    }
    callback(error);
  }
}

// ------------------------------------------------------------- the zlib family

const zlibDefaults = {
  flush: C.Z_NO_FLUSH,
  finishFlush: C.Z_FINISH,
  fullFlush: C.Z_FULL_FLUSH,
  minimum: C.Z_NO_FLUSH,
  maximum: C.Z_BLOCK,
  family: "zlib",
} satisfies FlushDefaults;

interface ZlibInitialization {
  readonly handle: number;
  readonly level: number;
  readonly strategy: number;
}

function initializationError(handle: number, fallbackMessage: string): ZlibError {
  const nativeStatus = nts_zlib_last_status();
  return new ZlibError(
    nts_zlib_error_message(handle) || fallbackMessage,
    nativeStatus === 0 ? handle : nativeStatus,
    nts_zlib_error_code(handle),
  );
}

function initializeZlib(mode: number, options?: ZlibOptions): ZlibInitialization {
  let windowBits = C.Z_DEFAULT_WINDOWBITS;
  let level = C.Z_DEFAULT_COMPRESSION;
  let memLevel = C.Z_DEFAULT_MEMLEVEL;
  let strategy = C.Z_DEFAULT_STRATEGY;
  let dictionary: Uint8Array = new Uint8Array(0);

  if (options) {
    // `windowBits` is special twice over.
    //
    // Zero is invalid when compressing and meaningful when decompressing: it
    // tells zlib to take the window size from the header of the stream it is
    // reading, which is the only correct choice when the stream came from
    // somewhere else.
    //
    // And the minimum differs by format. `windowBits: 8` produces a valid
    // deflate stream but not a valid gzip one, so gzip's floor is one higher.
    if (
      (options.windowBits == null || options.windowBits === 0) &&
      (mode === C.INFLATE || mode === C.GUNZIP || mode === C.UNZIP)
    ) {
      windowBits = 0;
    } else {
      const min = C.Z_MIN_WINDOWBITS + (mode === C.GZIP ? 1 : 0);
      windowBits = inRangeOrDefault(
        options.windowBits,
        "options.windowBits",
        min,
        C.Z_MAX_WINDOWBITS,
        C.Z_DEFAULT_WINDOWBITS,
      );
    }

    level = inRangeOrDefault(options.level, "options.level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, C.Z_DEFAULT_COMPRESSION);
    memLevel = inRangeOrDefault(options.memLevel, "options.memLevel", C.Z_MIN_MEMLEVEL, C.Z_MAX_MEMLEVEL, C.Z_DEFAULT_MEMLEVEL);
    strategy = inRangeOrDefault(options.strategy, "options.strategy", C.Z_DEFAULT_STRATEGY, C.Z_FIXED, C.Z_DEFAULT_STRATEGY);

    dictionary = optionalByteView(options.dictionary, "options.dictionary");
  }

  const handle = nts_zlib_create(
    mode,
    level,
    windowBits,
    memLevel,
    strategy,
    dictionary,
    rejectGarbageAfterEnd(options),
  );
  if (handle < 0) {
    throw initializationError(handle, "Failed to initialize the compression engine");
  }
  return { handle, level, strategy };
}

export class Zlib extends ZlibBase {
  _level: number;
  _strategy: number;
  _mode: number;

  constructor(options: ZlibOptions | undefined, mode: number) {
    const initialization = initializeZlib(mode, options);
    super(options, initialization.handle, zlibDefaults);
    this._level = initialization.level;
    this._strategy = initialization.strategy;
    this._mode = mode;
  }

  /**
   * Change the compression level or strategy after all earlier writes finish.
   */
  params(level: number, strategy: number, callback?: () => void): void {
    inRangeOrDefault(level, "level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, C.Z_DEFAULT_LEVEL);
    inRangeOrDefault(
      strategy,
      "strategy",
      C.Z_DEFAULT_STRATEGY,
      C.Z_FIXED,
      C.Z_DEFAULT_STRATEGY,
    );
    if (callback !== undefined) validateFunction(callback, "callback");

    if (this._level === level && this._strategy === strategy) {
      if (callback !== undefined) nextTick(callback);
      return;
    }

    this.flush(C.Z_SYNC_FLUSH, () => {
      if (this._handle === null) return;
      this._handle.setParameters(level, strategy);
      if (this.destroyed) return;
      this._level = level;
      this._strategy = strategy;
      if (callback !== undefined) callback();
    });
  }
}

export class Deflate extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.DEFLATE);
  }
}
export class Inflate extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.INFLATE);
  }
}
export class Gzip extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.GZIP);
  }
}
export class Gunzip extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.GUNZIP);
  }
}
export class DeflateRaw extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.DEFLATERAW);
  }
}
export class InflateRaw extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.INFLATERAW);
  }
}

/**
 * Decompress either a zlib or a gzip stream, deciding from the first bytes.
 *
 * The two formats have different headers, so the engine can tell them apart —
 * which is what you want when reading something whose encoding was declared by
 * someone else and may be wrong.
 */
export class Unzip extends Zlib {
  constructor(options?: ZlibOptions) {
    super(options, C.UNZIP);
  }
}

// ---------------------------------------------------------------- brotli

const brotliDefaults = {
  flush: C.BROTLI_OPERATION_PROCESS,
  finishFlush: C.BROTLI_OPERATION_FINISH,
  fullFlush: C.BROTLI_OPERATION_FLUSH,
  minimum: C.BROTLI_OPERATION_PROCESS,
  maximum: C.BROTLI_OPERATION_EMIT_METADATA,
  family: "brotli",
} satisfies FlushDefaults;

/**
 * The parameter keys each engine has.
 *
 * Checked here rather than left to the library, because passing an unknown key
 * to brotli is not an error there -- it is ignored -- so a caller who
 * mistyped a constant would get silently different compression rather than a
 * complaint.
 */
const BROTLI_ENCODER_PARAM_MAX = C.BROTLI_PARAM_NDIRECT;

function parameterTable(
  options: ZlibOptions | undefined,
  mode: number,
): [number[], number[]] {
  if (mode === C.BROTLI_ENCODE || mode === C.BROTLI_DECODE) {
    return parameterArrays(options?.params, BROTLI_ENCODER_PARAM_MAX, "brotli");
  }
  return parameterArrays(
    options?.params,
    mode === C.ZSTD_COMPRESS ? 402 : C.ZSTD_d_windowLogMax,
    "zstd",
  );
}

function pledgedSourceSize(options: ZlibOptions | undefined): number {
  const value = options?.pledgedSrcSize;
  if (value === undefined) return -1;
  validateInteger(value, "options.pledgedSrcSize", 0);
  return value;
}

export class Brotli extends ZlibBase {
  constructor(options: ZlibOptions | undefined, mode: number) {
    const [keys, values] = parameterTable(options, mode);
    const dictionary = optionalByteView(options?.dictionary, "options.dictionary");
    const handle = nts_zlib_create_params(
      mode,
      keys,
      values,
      dictionary,
      -1,
      rejectGarbageAfterEnd(options),
    );
    if (handle < 0) {
      throw initializationError(handle, "Failed to initialize the brotli engine");
    }
    super(options, handle, brotliDefaults);
  }
}

export class BrotliCompress extends Brotli {
  constructor(options?: ZlibOptions) {
    super(options, C.BROTLI_ENCODE);
  }
}
export class BrotliDecompress extends Brotli {
  constructor(options?: ZlibOptions) {
    super(options, C.BROTLI_DECODE);
  }
}

// ------------------------------------------------------------------- zstd

const zstdDefaults = {
  flush: C.ZSTD_e_continue,
  finishFlush: C.ZSTD_e_end,
  fullFlush: C.ZSTD_e_flush,
  minimum: C.ZSTD_e_continue,
  maximum: C.ZSTD_e_end,
  family: "zstd",
} satisfies FlushDefaults;

export class Zstd extends ZlibBase {
  constructor(options: ZlibOptions | undefined, mode: number) {
    const [keys, values] = parameterTable(options, mode);
    const dictionary = optionalByteView(options?.dictionary, "options.dictionary");
    const handle = nts_zlib_create_params(
      mode,
      keys,
      values,
      dictionary,
      mode === C.ZSTD_COMPRESS ? pledgedSourceSize(options) : -1,
      rejectGarbageAfterEnd(options),
    );
    if (handle < 0) {
      throw initializationError(handle, "Failed to initialize the zstd engine");
    }
    super(options, handle, zstdDefaults);
  }
}

export class ZstdCompress extends Zstd {
  constructor(options?: ZlibOptions) {
    super(options, C.ZSTD_COMPRESS);
  }
}
export class ZstdDecompress extends Zstd {
  constructor(options?: ZlibOptions) {
    super(options, C.ZSTD_DECOMPRESS);
  }
}

// ------------------------------------------------------- one-shot convenience

export interface CompressionResult {
  readonly buffer: Buffer;
  readonly engine: ZlibBase;
}

export type OneShotResult = Buffer | CompressionResult;
type OneShotCallback = (error: unknown, result?: OneShotResult) => void;

function asBytes(input: unknown, name: string): Uint8Array {
  if (typeof input === "string") return Buffer.from(input);
  if (
    input instanceof ArrayBuffer || input instanceof SharedArrayBuffer ||
    ArrayBuffer.isView(input)
  ) {
    return byteView(input, name);
  }
  throw new ERR_INVALID_ARG_TYPE(
    name,
    ["string", "Buffer", "TypedArray", "DataView", "ArrayBuffer"],
    input,
  );
}

/** The parameters a one-shot needs, resolved the same way a stream's are. */
interface ZlibArguments {
  readonly level: number;
  readonly windowBits: number;
  readonly memLevel: number;
  readonly strategy: number;
  readonly dictionary: Uint8Array;
  readonly finishFlush: number;
  readonly rejectGarbageAfterEnd: boolean;
}

function zlibArguments(mode: number, options?: ZlibOptions): ZlibArguments {
  return {
    level: inRangeOrDefault(options?.level, "options.level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, C.Z_DEFAULT_COMPRESSION),
    windowBits: inRangeOrDefault(options?.windowBits, "options.windowBits", C.Z_MIN_WINDOWBITS, C.Z_MAX_WINDOWBITS, C.Z_DEFAULT_WINDOWBITS),
    memLevel: inRangeOrDefault(options?.memLevel, "options.memLevel", C.Z_MIN_MEMLEVEL, C.Z_MAX_MEMLEVEL, C.Z_DEFAULT_MEMLEVEL),
    strategy: inRangeOrDefault(options?.strategy, "options.strategy", C.Z_DEFAULT_STRATEGY, C.Z_FIXED, C.Z_DEFAULT_STRATEGY),
    dictionary: optionalByteView(options?.dictionary, "options.dictionary"),
    finishFlush: finishFlushForMode(mode, options),
    rejectGarbageAfterEnd: rejectGarbageAfterEnd(options),
  };
}

function finishFlushForMode(mode: number, options?: ZlibOptions): number {
  const defaults = mode === C.BROTLI_ENCODE || mode === C.BROTLI_DECODE
    ? brotliDefaults
    : (mode === C.ZSTD_COMPRESS || mode === C.ZSTD_DECOMPRESS
      ? zstdDefaults
      : zlibDefaults);
  inRangeOrDefault(
    options?.flush,
    "options.flush",
    defaults.minimum,
    defaults.maximum,
    defaults.flush,
  );
  return inRangeOrDefault(
    options?.finishFlush,
    "options.finishFlush",
    defaults.minimum,
    defaults.maximum,
    defaults.finishFlush,
  );
}

function engineForMode(mode: number, options?: ZlibOptions): ZlibBase {
  switch (mode) {
    case C.DEFLATE: return new Deflate(options);
    case C.INFLATE: return new Inflate(options);
    case C.GZIP: return new Gzip(options);
    case C.GUNZIP: return new Gunzip(options);
    case C.DEFLATERAW: return new DeflateRaw(options);
    case C.INFLATERAW: return new InflateRaw(options);
    case C.UNZIP: return new Unzip(options);
    case C.BROTLI_ENCODE: return new BrotliCompress(options);
    case C.BROTLI_DECODE: return new BrotliDecompress(options);
    case C.ZSTD_COMPRESS: return new ZstdCompress(options);
    case C.ZSTD_DECOMPRESS: return new ZstdDecompress(options);
    default: throw new ERR_OUT_OF_RANGE("mode", "a supported compression mode", mode);
  }
}

function maximumOutputLength(options?: ZlibOptions): number {
  return inRangeOrDefault(
    options?.maxOutputLength,
    "options.maxOutputLength",
    1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
}

function throwOneShotError(maximumOutput: number): void {
  const status = nts_zlib_last_status();
  if (status === 0) return;

  const code = nts_zlib_last_error_code();
  if (code === "ERR_BUFFER_TOO_LARGE") {
    throw new ERR_BUFFER_TOO_LARGE(maximumOutput);
  }
  if (code === "ERR_TRAILING_JUNK_AFTER_STREAM_END") {
    throw new ERR_TRAILING_JUNK_AFTER_STREAM_END();
  }
  throw new ZlibError(nts_zlib_last_error_message(), status, code);
}

function oneShotSync(mode: number, input: unknown, options?: ZlibOptions): OneShotResult {
  const bytes = asBytes(input, "buffer");
  let output: Uint8Array;
  let maximum: number;

  if (mode >= C.BROTLI_DECODE) {
    const [keys, values] = parameterTable(options, mode);
    const dictionary = optionalByteView(options?.dictionary, "options.dictionary");
    const sourceSize = mode === C.ZSTD_COMPRESS ? pledgedSourceSize(options) : -1;
    const finishFlush = finishFlushForMode(mode, options);
    const rejectTrailingGarbage = rejectGarbageAfterEnd(options);
    maximum = maximumOutputLength(options);
    output = nts_zlib_oneshot_params(
      mode,
      keys,
      values,
      dictionary,
      sourceSize,
      finishFlush,
      maximum,
      bytes,
      rejectTrailingGarbage,
    );
  } else {
    const argumentsForZlib = zlibArguments(mode, options);
    maximum = maximumOutputLength(options);
    output = nts_zlib_oneshot(
      mode,
      argumentsForZlib.level,
      argumentsForZlib.windowBits,
      argumentsForZlib.memLevel,
      argumentsForZlib.strategy,
      argumentsForZlib.dictionary,
      argumentsForZlib.finishFlush,
      maximum,
      bytes,
      argumentsForZlib.rejectGarbageAfterEnd,
    );
  }

  throwOneShotError(maximum);
  if (output.byteLength > maximum) throw new ERR_BUFFER_TOO_LARGE(maximum);
  const buffer = Buffer.from(output);
  if (!options?.info) return buffer;

  // Node returns the engine that performed the synchronous operation. The
  // native one-shot entry point owns the actual work here, so construct the
  // same public engine shape, record its input count, and close its unused
  // incremental handle before exposing it.
  const engine = engineForMode(mode, options);
  engine.bytesWritten = bytes.byteLength;
  engine.close();
  return { buffer, engine };
}

function oneShot(
  mode: number,
  input: unknown,
  options: ZlibOptions | OneShotCallback | undefined,
  callback?: OneShotCallback,
): void {
  let completion = callback;
  let compressionOptions: ZlibOptions | undefined;
  if (typeof options === "function") {
    completion = options;
    compressionOptions = undefined;
  } else {
    compressionOptions = options;
  }
  validateFunction(completion, "callback");
  // On a tick, so a one-shot never calls back before it has returned. Node
  // runs the work on the thread pool; the difference is when the *work*
  // happens, not when the caller hears about it.
  nextTick(() => {
    let result: OneShotResult;
    try {
      result = oneShotSync(mode, input, compressionOptions);
    } catch (error) {
      completion(error);
      return;
    }
    // Deliberately outside the try: an exception from user callback code must
    // propagate once, not be mistaken for compression failure and delivered
    // to the same callback a second time.
    completion(null, result);
  });
}

export function deflate(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.DEFLATE, input, options, callback); }
export function deflateSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.DEFLATE, input, options);
}
export function inflate(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.INFLATE, input, options, callback); }
export function inflateSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.INFLATE, input, options);
}
export function gzip(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.GZIP, input, options, callback); }
export function gzipSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.GZIP, input, options);
}
export function gunzip(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.GUNZIP, input, options, callback); }
export function gunzipSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.GUNZIP, input, options);
}
export function deflateRaw(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.DEFLATERAW, input, options, callback); }
export function deflateRawSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.DEFLATERAW, input, options);
}
export function inflateRaw(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.INFLATERAW, input, options, callback); }
export function inflateRawSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.INFLATERAW, input, options);
}
export function unzip(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.UNZIP, input, options, callback); }
export function unzipSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.UNZIP, input, options);
}
export function brotliCompress(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.BROTLI_ENCODE, input, options, callback); }
export function brotliCompressSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.BROTLI_ENCODE, input, options);
}
export function brotliDecompress(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.BROTLI_DECODE, input, options, callback); }
export function brotliDecompressSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.BROTLI_DECODE, input, options);
}
export function zstdCompress(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.ZSTD_COMPRESS, input, options, callback); }
export function zstdCompressSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.ZSTD_COMPRESS, input, options);
}
export function zstdDecompress(
  input: unknown,
  options?: ZlibOptions | OneShotCallback,
  callback?: OneShotCallback,
): void { oneShot(C.ZSTD_DECOMPRESS, input, options, callback); }
export function zstdDecompressSync(input: unknown, options?: ZlibOptions): OneShotResult {
  return oneShotSync(C.ZSTD_DECOMPRESS, input, options);
}

export const createDeflate = (o?: ZlibOptions) => new Deflate(o);
export const createInflate = (o?: ZlibOptions) => new Inflate(o);
export const createGzip = (o?: ZlibOptions) => new Gzip(o);
export const createGunzip = (o?: ZlibOptions) => new Gunzip(o);
export const createDeflateRaw = (o?: ZlibOptions) => new DeflateRaw(o);
export const createInflateRaw = (o?: ZlibOptions) => new InflateRaw(o);
export const createUnzip = (o?: ZlibOptions) => new Unzip(o);
export const createBrotliCompress = (o?: ZlibOptions) => new BrotliCompress(o);
export const createBrotliDecompress = (o?: ZlibOptions) => new BrotliDecompress(o);
export const createZstdCompress = (o?: ZlibOptions) => new ZstdCompress(o);
export const createZstdDecompress = (o?: ZlibOptions) => new ZstdDecompress(o);

/**
 * The CRC-32 of some bytes, optionally continuing a previous value.
 *
 * Here because zlib computes it and gzip's trailer needs it, not because it is
 * a compression function. It is a checksum for accidental corruption and not
 * for anything adversarial.
 */
export function crc32(input: string | Buffer, initial = 0): number {
  if (typeof input !== "string" && !(input instanceof Buffer) && !ArrayBuffer.isView(input)) {
    throw new ERR_INVALID_ARG_TYPE("data", ["string", "Buffer", "TypedArray", "DataView"], input);
  }
  return nts_crc32(asBytes(input, "data"), initial);
}
