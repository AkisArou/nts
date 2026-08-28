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
  ERR_BROTLI_INVALID_PARAM,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { validateFunction } from "../../internal/validators.ts";
import * as C from "./constants.ts";

export * as constants from "./constants.ts";
export { codes } from "./constants.ts";

/**
 * Build an engine. A negative return is a failure code rather than a handle.
 *
 * The parameters are zlib's own and are passed through rather than bundled
 * into an options object, because their meanings are the library's: a
 * `windowBits` of 15 and of 31 select different *formats*, not different
 * amounts of memory.
 */
declare function nts_zlib_create(
  mode: number,
  level: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
  dictionary: number[],
): number;

/** Brotli and zstd take a parameter table rather than fixed arguments. */
declare function nts_zlib_create_params(
  mode: number,
  keys: number[],
  values: number[],
): number;

/**
 * Feed input and take whatever comes out.
 *
 * Asynchronous because compression of a large chunk is real work and node runs
 * it on the thread pool; `Transform._transform` takes a callback, so nothing
 * has to block for it.
 */
declare function nts_zlib_write(
  handle: number,
  flush: number,
  input: number[],
  callback: (code: number, output: number[]) => void,
): void;

/** The whole of a one-shot compression or decompression, on this thread. */
declare function nts_zlib_oneshot(
  mode: number,
  level: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
  dictionary: number[],
  finishFlush: number,
  input: number[],
): number[];

declare function nts_zlib_oneshot_params(
  mode: number,
  keys: number[],
  values: number[],
  input: number[],
): number[];

declare function nts_zlib_error_message(handle: number): string;
declare function nts_zlib_reset(handle: number): void;
declare function nts_zlib_params(handle: number, level: number, strategy: number): number;
declare function nts_zlib_close(handle: number): void;
declare function nts_crc32(input: number[], initial: number): number;

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
  dictionary?: Buffer | undefined;
  info?: boolean | undefined;
  maxOutputLength?: number | undefined;
  params?: Record<number, number> | undefined;
}

/** A number in range, or the default if it was not given at all. */
function inRangeOrDefault(
  value: unknown,
  name: string,
  min: number,
  max: number,
  byDefault: number,
): number {
  if (value === undefined) return byDefault;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
  }
  return value;
}

/** A `zlib` failure, carrying the library's own code and name. */
export class ZlibError extends Error {
  errno: number;
  code: string;

  constructor(message: string, errno: number) {
    super(message);
    this.errno = errno;
    this.code = (C.codes[String(errno)] as string) ?? "Z_UNKNOWN";
    this.name = "Error";
  }
}

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
  _handle: number | null;
  _chunkSize: number;
  _defaultFlushFlag: number;
  _finishFlushFlag: number;
  _defaultFullFlushFlag: number;
  _maxOutputLength: number;
  _info: boolean;
  #closed = false;

  constructor(
    options: ZlibOptions | undefined,
    handle: number,
    defaults: { flush: number; finishFlush: number; fullFlush: number },
  ) {
    const chunkSize = options?.chunkSize ?? C.Z_DEFAULT_CHUNK;
    if (chunkSize < C.Z_MIN_CHUNK) {
      throw new ERR_OUT_OF_RANGE("options.chunkSize", `>= ${C.Z_MIN_CHUNK}`, chunkSize);
    }

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

    this._handle = handle;
    this._chunkSize = chunkSize;
    this._defaultFlushFlag = options?.flush ?? defaults.flush;
    this._finishFlushFlag = options?.finishFlush ?? defaults.finishFlush;
    this._defaultFullFlushFlag = defaults.fullFlush;
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
    // The last chunk also carries the finishing flush, or the engine would
    // keep its final block and the output would be truncated.
    const isLast = this.writableEnded && this.writableLength === (chunk as Buffer).length;
    const flush = isLast
      ? Math.max(this._defaultFlushFlag, this._finishFlushFlag)
      : this._defaultFlushFlag;
    this.#run(chunk as Buffer, flush, callback);
  }

  override _flush(callback: (error?: unknown) => void): void {
    // Whatever the engine is still holding.
    this.#run(Buffer.alloc(0), this._finishFlushFlag, callback);
  }

  #run(chunk: Buffer, flush: number, callback: (error?: unknown) => void): void {
    if (this._handle === null) {
      nextTick(callback);
      return;
    }
    const handle = this._handle;
    this.bytesWritten += chunk.length;

    nts_zlib_write(handle, flush, Array.from(chunk) as number[], (code, output) => {
      if (code < 0) {
        callback(new ZlibError(nts_zlib_error_message(handle), code));
        return;
      }
      if (output.length > this._maxOutputLength) {
        callback(new RangeError(`Cannot create a Buffer larger than ${this._maxOutputLength} bytes`));
        return;
      }
      if (output.length > 0) this.push(Buffer.from(output));
      callback();
    });
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

    if (this.writableFinished) {
      if (callback) nextTick(callback);
    } else if (this.writableEnded) {
      if (callback) this.once("end", callback);
    } else {
      const marker = Buffer.alloc(0) as Buffer & { [key: symbol]: number };
      marker[kFlushFlag] = (kind as number) ?? this._defaultFullFlushFlag;
      this.write(marker, undefined, callback as never);
    }
  }

  /** Forget everything and start a new stream on the same engine. */
  reset(): void {
    if (this._handle === null) throw new Error("zlib binding closed");
    nts_zlib_reset(this._handle);
  }

  /**
   * Change the compression level or strategy mid-stream.
   *
   * The engine has to flush first: the bytes already produced were compressed
   * under the old settings, and a reader decoding them under the new ones
   * would be reading a different stream.
   */
  params(level: number, strategy: number, callback?: () => void): void {
    inRangeOrDefault(level, "level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, C.Z_DEFAULT_LEVEL);
    inRangeOrDefault(strategy, "strategy", C.Z_DEFAULT_STRATEGY, C.Z_FIXED, C.Z_DEFAULT_STRATEGY);
    if (callback !== undefined) validateFunction(callback, "callback");

    this.flush(C.Z_SYNC_FLUSH, () => {
      if (this._handle !== null) nts_zlib_params(this._handle, level, strategy);
      if (callback) callback();
    });
  }

  close(callback?: () => void): void {
    if (callback) finished(this, callback);
    this.destroy();
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (!this.#closed && this._handle !== null) {
      this.#closed = true;
      nts_zlib_close(this._handle);
      this._handle = null;
    }
    callback(error);
  }
}

/** Carries a flush request through the write queue on a zero-length chunk. */
const kFlushFlag = Symbol("kFlushFlag");

// ------------------------------------------------------------- the zlib family

const zlibDefaults = {
  flush: C.Z_NO_FLUSH,
  finishFlush: C.Z_FINISH,
  fullFlush: C.Z_FULL_FLUSH,
};

function zlibHandle(mode: number, options?: ZlibOptions): number {
  let windowBits = C.Z_DEFAULT_WINDOWBITS;
  let level = C.Z_DEFAULT_COMPRESSION;
  let memLevel = C.Z_DEFAULT_MEMLEVEL;
  let strategy = C.Z_DEFAULT_STRATEGY;
  let dictionary: number[] = [];

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

    if (options.dictionary !== undefined) {
      const given = options.dictionary as unknown;
      if (ArrayBuffer.isView(given)) {
        dictionary = Array.from(
          Buffer.from((given as ArrayBufferView).buffer as ArrayBuffer, given.byteOffset, given.byteLength),
        ) as number[];
      } else if (given instanceof ArrayBuffer) {
        dictionary = Array.from(Buffer.from(given)) as number[];
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "options.dictionary",
          ["Buffer", "TypedArray", "DataView", "ArrayBuffer"],
          given,
        );
      }
    }
  }

  const handle = nts_zlib_create(mode, level, windowBits, memLevel, strategy, dictionary);
  if (handle < 0) throw new ZlibError("Failed to initialize the compression engine", handle);
  return handle;
}

export class Zlib extends ZlibBase {
  constructor(options: ZlibOptions | undefined, mode: number) {
    super(options, zlibHandle(mode, options), zlibDefaults);
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
};

/**
 * The parameter keys each engine has.
 *
 * Checked here rather than left to the library, because passing an unknown key
 * to brotli is not an error there -- it is ignored -- so a caller who
 * mistyped a constant would get silently different compression rather than a
 * complaint.
 */
const BROTLI_ENCODER_PARAM_MAX = C.BROTLI_PARAM_NDIRECT;
const BROTLI_DECODER_PARAM_MAX = C.BROTLI_DECODER_PARAM_LARGE_WINDOW;

function parameterTable(
  options: ZlibOptions | undefined,
  mode: number,
): [number[], number[]] {
  const keys: number[] = [];
  const values: number[] = [];
  if (options?.params) {
    const max = mode === C.BROTLI_ENCODE
      ? BROTLI_ENCODER_PARAM_MAX
      : mode === C.BROTLI_DECODE
        ? BROTLI_DECODER_PARAM_MAX
        : Infinity;

    for (const [key, value] of Object.entries(options.params)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > max) {
        throw new ERR_BROTLI_INVALID_PARAM(key);
      }
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new ERR_INVALID_ARG_TYPE(`options.params[${key}]`, "number", value);
      }
      keys.push(index);
      values.push(value);
    }
  }
  return [keys, values];
}

export class Brotli extends ZlibBase {
  constructor(options: ZlibOptions | undefined, mode: number) {
    const [keys, values] = parameterTable(options, mode);
    const handle = nts_zlib_create_params(mode, keys, values);
    if (handle < 0) throw new ZlibError("Failed to initialize the brotli engine", handle);
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
};

export class Zstd extends ZlibBase {
  constructor(options: ZlibOptions | undefined, mode: number) {
    const [keys, values] = parameterTable(options, mode);
    const handle = nts_zlib_create_params(mode, keys, values);
    if (handle < 0) throw new ZlibError("Failed to initialize the zstd engine", handle);
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

type OneShotCallback = (error: unknown, result?: Buffer) => void;

function asBytes(input: unknown, name: string): number[] {
  if (typeof input === "string") return Array.from(Buffer.from(input)) as number[];
  if (input instanceof Buffer) return Array.from(input) as number[];
  if (ArrayBuffer.isView(input)) {
    return Array.from(
      Buffer.from((input as ArrayBufferView).buffer as ArrayBuffer, input.byteOffset, input.byteLength),
    ) as number[];
  }
  if (input instanceof ArrayBuffer) return Array.from(Buffer.from(input)) as number[];
  throw new ERR_INVALID_ARG_TYPE(name, ["string", "Buffer", "TypedArray", "DataView", "ArrayBuffer"], input);
}

/** The parameters a one-shot needs, resolved the same way a stream's are. */
function zlibArguments(mode: number, options?: ZlibOptions) {
  return {
    level: inRangeOrDefault(options?.level, "options.level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, C.Z_DEFAULT_COMPRESSION),
    windowBits: inRangeOrDefault(options?.windowBits, "options.windowBits", C.Z_MIN_WINDOWBITS, C.Z_MAX_WINDOWBITS, C.Z_DEFAULT_WINDOWBITS),
    memLevel: inRangeOrDefault(options?.memLevel, "options.memLevel", C.Z_MIN_MEMLEVEL, C.Z_MAX_MEMLEVEL, C.Z_DEFAULT_MEMLEVEL),
    strategy: inRangeOrDefault(options?.strategy, "options.strategy", C.Z_DEFAULT_STRATEGY, C.Z_FIXED, C.Z_DEFAULT_STRATEGY),
    dictionary: options?.dictionary ? Array.from(options.dictionary) as number[] : [],
    finishFlush: options?.finishFlush ?? (mode >= C.BROTLI_DECODE ? C.BROTLI_OPERATION_FINISH : C.Z_FINISH),
  };
}

function oneShotSync(mode: number, input: unknown, options?: ZlibOptions): Buffer {
  const bytes = asBytes(input, "buffer");
  const output = mode >= C.BROTLI_DECODE
    ? (() => {
      const [keys, values] = parameterTable(options, mode);
      return nts_zlib_oneshot_params(mode, keys, values, bytes);
    })()
    : (() => {
      const a = zlibArguments(mode, options);
      return nts_zlib_oneshot(
        mode, a.level, a.windowBits, a.memLevel, a.strategy, a.dictionary, a.finishFlush, bytes,
      );
    })();
  return Buffer.from(output);
}

function oneShot(
  mode: number,
  input: unknown,
  options: ZlibOptions | OneShotCallback | undefined,
  callback?: OneShotCallback,
): void {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  validateFunction(callback, "callback");
  // On a tick, so a one-shot never calls back before it has returned. Node
  // runs the work on the thread pool; the difference is when the *work*
  // happens, not when the caller hears about it.
  nextTick(() => {
    try {
      (callback as OneShotCallback)(null, oneShotSync(mode, input, options as ZlibOptions));
    } catch (error) {
      (callback as OneShotCallback)(error);
    }
  });
}

const shorthand = (mode: number) => ({
  async: (input: unknown, options?: ZlibOptions | OneShotCallback, callback?: OneShotCallback) =>
    oneShot(mode, input, options, callback),
  sync: (input: unknown, options?: ZlibOptions) => oneShotSync(mode, input, options),
});

export const deflate = shorthand(C.DEFLATE).async;
export const deflateSync = shorthand(C.DEFLATE).sync;
export const inflate = shorthand(C.INFLATE).async;
export const inflateSync = shorthand(C.INFLATE).sync;
export const gzip = shorthand(C.GZIP).async;
export const gzipSync = shorthand(C.GZIP).sync;
export const gunzip = shorthand(C.GUNZIP).async;
export const gunzipSync = shorthand(C.GUNZIP).sync;
export const deflateRaw = shorthand(C.DEFLATERAW).async;
export const deflateRawSync = shorthand(C.DEFLATERAW).sync;
export const inflateRaw = shorthand(C.INFLATERAW).async;
export const inflateRawSync = shorthand(C.INFLATERAW).sync;
export const unzip = shorthand(C.UNZIP).async;
export const unzipSync = shorthand(C.UNZIP).sync;
export const brotliCompress = shorthand(C.BROTLI_ENCODE).async;
export const brotliCompressSync = shorthand(C.BROTLI_ENCODE).sync;
export const brotliDecompress = shorthand(C.BROTLI_DECODE).async;
export const brotliDecompressSync = shorthand(C.BROTLI_DECODE).sync;
export const zstdCompress = shorthand(C.ZSTD_COMPRESS).async;
export const zstdCompressSync = shorthand(C.ZSTD_COMPRESS).sync;
export const zstdDecompress = shorthand(C.ZSTD_DECOMPRESS).async;
export const zstdDecompressSync = shorthand(C.ZSTD_DECOMPRESS).sync;

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
