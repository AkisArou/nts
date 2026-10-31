// `node:zlib/iter`, from Node v26.13.0
// `lib/internal/streams/iter/transform.js`.
//
// These descriptors drive the compression engine directly. They deliberately
// do not construct a classic Transform stream: iterator pipelines already
// provide ordering and backpressure, so an EventEmitter layer would only add
// allocations and callbacks around the same native operation.

import {
  ERR_BROTLI_INVALID_PARAM,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
  ERR_ZSTD_INVALID_PARAM,
} from "../../internal/errors.ts";
import {
  kValidateObjectAllowArray,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import type { TransformOptions } from "../../stream/src/iter/pull.ts";
import { kValidatedTransform } from "../../stream/src/iter/types.ts";
import {
  type ByteBatch,
  type StreamAbortSignal,
} from "../../stream/src/iter/utils.ts";
import { Buffer } from "../../buffer/src/main.ts";
import * as C from "./constants.ts";
import { zlibCodeForStatus } from "./error-code.ts";
import { optionalByteView, type BinaryInput } from "./options.ts";

const DEFAULT_OUTPUT_SIZE = 65_536;
const NO_PLEDGED_SOURCE_SIZE = -1;
const BATCH_HWM = DEFAULT_OUTPUT_SIZE;
const kMaxBrotliParam = Math.max(
  ...Object.entries(C).map(([key, value]) => key.startsWith("BROTLI_PARAM_") ? value as number : 0),
);
const kMaxZstdCParam = Math.max(
  ...Object.entries(C).map(([key, value]) => key.startsWith("ZSTD_c_") ? value as number : 0),
);
const kMaxZstdDParam = Math.max(
  ...Object.entries(C).map(([key, value]) => key.startsWith("ZSTD_d_") ? value as number : 0),
);

type EngineFamily = "zlib" | "brotli" | "zstd";
type SyncTransformSource = Iterable<ByteBatch | null>;
type AsyncTransformSource = AsyncIterable<ByteBatch | null>;

/** Options common to every iterable compression engine. */
export interface IteratorCompressionOptions {
  chunkSize?: number | undefined;
  dictionary?: BinaryInput | undefined;
}

/** Deflate, inflate, gzip, and gunzip tuning. */
export interface IteratorZlibOptions extends IteratorCompressionOptions {
  windowBits?: number | undefined;
  level?: number | undefined;
  memLevel?: number | undefined;
  strategy?: number | undefined;
}

/** Brotli's numeric parameter table. */
export interface IteratorBrotliOptions extends IteratorCompressionOptions {
  params?: Readonly<Record<number, number | boolean>> | undefined;
}

/** Zstandard's numeric parameter table and optional source-size pledge. */
export interface IteratorZstdOptions extends IteratorCompressionOptions {
  params?: Readonly<Record<number, number | boolean>> | undefined;
  pledgedSrcSize?: number | undefined;
}

interface IteratorEngineOptions
  extends IteratorZlibOptions, IteratorBrotliOptions, IteratorZstdOptions {}

interface TransformConfiguration {
  readonly mode: number;
  readonly family: EngineFamily;
  readonly processFlag: number;
  readonly finishFlag: number;
  readonly chunkSize: number;
  readonly level: number;
  readonly windowBits: number;
  readonly memLevel: number;
  readonly strategy: number;
  readonly dictionary: Uint8Array;
  readonly parameterKeys: number[];
  readonly parameterValues: number[];
  readonly pledgedSourceSize: number;
}

class IteratorZlibError extends Error {
  readonly errno: number;
  readonly code: string;

  constructor(message: string, errno: number, code: string) {
    super(message);
    this.name = "Error";
    this.errno = errno;
    this.code = code;
  }
}

function numberInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  defaultValue: number,
): number {
  if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
    return defaultValue;
  }
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isFinite(value)) {
    throw new ERR_OUT_OF_RANGE(name, "a finite number", value);
  }
  if (value < minimum || value > maximum) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${minimum} and <= ${maximum}`, value);
  }
  return value;
}

function outputSize(options: IteratorEngineOptions): number {
  const value = options.chunkSize;
  if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
    return DEFAULT_OUTPUT_SIZE;
  }
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE("options.chunkSize", "number", value);
  }
  if (!Number.isFinite(value)) {
    throw new ERR_OUT_OF_RANGE("options.chunkSize", "a finite number", value);
  }
  if (value < C.Z_MIN_CHUNK) {
    throw new ERR_OUT_OF_RANGE("options.chunkSize", `>= ${C.Z_MIN_CHUNK}`, value);
  }
  return value;
}

interface IteratorParameters {
  readonly [name: string]: unknown;
}

type InvalidParameterConstructor = new (name: string) => Error;

// Node v26.13.0 transform.js:111-127. Keep the constructor argument and the
// upstream validation order, including arrays and numeric-key coercion.
function validateParams(
  params: IteratorParameters | undefined,
  maximum: number,
  ErrorClass: InvalidParameterConstructor,
): void {
  if (params === undefined) return;
  validateObject(params, "options.params", kValidateObjectAllowArray);
  const keys = Object.keys(params);
  for (let i = 0; i < keys.length; i++) {
    const originalKey = keys[i]!;
    const key = +originalKey;
    if (Number.isNaN(key) || key < 0 || key > maximum) {
      throw new ErrorClass(originalKey);
    }
    const value = params[originalKey];
    if (typeof value !== "number" && typeof value !== "boolean") {
      throw new ERR_INVALID_ARG_TYPE("options.params[key]", "number", value);
    }
  }
}

function iteratorParameters(
  params: IteratorParameters | undefined,
  maximum: number,
  ErrorClass: InvalidParameterConstructor,
  brotliEncoderDefaults: boolean,
): [number[], number[]] {
  validateParams(params, maximum, ErrorClass);
  const init = new Uint32Array(maximum + 1);
  init.fill(-1);
  if (brotliEncoderDefaults) {
    init[C.BROTLI_PARAM_QUALITY] = 6;
    init[C.BROTLI_PARAM_LGWIN] = 20;
  }
  if (params) {
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      init[+key] = params[key] as number;
    }
  }
  // The declared native operation receives the initialized slots. The typed
  // table above preserves upstream's coercion, sentinel and last-write rules.
  const keys: number[] = [];
  const values: number[] = [];
  for (let key = 0; key < init.length; key++) {
    const value = init[key]!;
    if (value !== 0xffff_ffff) {
      keys.push(key);
      values.push(value);
    }
  }
  return [keys, values];
}

function brotliParameters(mode: number, options: IteratorEngineOptions): [number[], number[]] {
  return iteratorParameters(
    options.params,
    kMaxBrotliParam,
    ERR_BROTLI_INVALID_PARAM,
    mode === C.BROTLI_ENCODE,
  );
}

function zstdParameters(mode: number, options: IteratorEngineOptions): [number[], number[]] {
  return iteratorParameters(
    options.params,
    mode === C.ZSTD_COMPRESS ? kMaxZstdCParam : kMaxZstdDParam,
    ERR_ZSTD_INVALID_PARAM,
    false,
  );
}

function pledgedSourceSize(mode: number, options: IteratorEngineOptions): number {
  if (mode !== C.ZSTD_COMPRESS) return NO_PLEDGED_SOURCE_SIZE;
  const value = options.pledgedSrcSize;
  if (value === undefined) return NO_PLEDGED_SOURCE_SIZE;
  validateInteger(value, "options.pledgedSrcSize", 0);
  return value;
}

function parseConfiguration(mode: number, options: IteratorEngineOptions): TransformConfiguration {
  const chunkSize = outputSize(options);
  const dictionary = optionalByteView(options.dictionary, "options.dictionary");

  if (mode === C.BROTLI_ENCODE || mode === C.BROTLI_DECODE) {
    const [parameterKeys, parameterValues] = brotliParameters(mode, options);
    return {
      mode,
      family: "brotli",
      processFlag: C.BROTLI_OPERATION_PROCESS,
      finishFlag: C.BROTLI_OPERATION_FINISH,
      chunkSize,
      level: 0,
      windowBits: 0,
      memLevel: 0,
      strategy: 0,
      dictionary,
      parameterKeys,
      parameterValues,
      pledgedSourceSize: NO_PLEDGED_SOURCE_SIZE,
    };
  }

  if (mode === C.ZSTD_COMPRESS || mode === C.ZSTD_DECOMPRESS) {
    const [parameterKeys, parameterValues] = zstdParameters(mode, options);
    return {
      mode,
      family: "zstd",
      processFlag: C.ZSTD_e_continue,
      finishFlag: C.ZSTD_e_end,
      chunkSize,
      level: 0,
      windowBits: 0,
      memLevel: 0,
      strategy: 0,
      dictionary,
      parameterKeys,
      parameterValues,
      pledgedSourceSize: pledgedSourceSize(mode, options),
    };
  }

  const windowBitsValue = options.windowBits;
  let windowBits: number;
  if (windowBitsValue === 0 && (mode === C.INFLATE || mode === C.GUNZIP)) {
    windowBits = 0;
  } else {
    windowBits = numberInRange(
      windowBitsValue,
      "options.windowBits",
      C.Z_MIN_WINDOWBITS + (mode === C.GZIP ? 1 : 0),
      C.Z_MAX_WINDOWBITS,
      C.Z_DEFAULT_WINDOWBITS,
    );
  }
  return {
    mode,
    family: "zlib",
    processFlag: C.Z_NO_FLUSH,
    finishFlag: C.Z_FINISH,
    chunkSize,
    level: numberInRange(options.level, "options.level", C.Z_MIN_LEVEL, C.Z_MAX_LEVEL, 4),
    windowBits,
    memLevel: numberInRange(
      options.memLevel,
      "options.memLevel",
      C.Z_MIN_MEMLEVEL,
      C.Z_MAX_MEMLEVEL,
      9,
    ),
    strategy: numberInRange(
      options.strategy,
      "options.strategy",
      C.Z_DEFAULT_STRATEGY,
      C.Z_FIXED,
      C.Z_DEFAULT_STRATEGY,
    ),
    dictionary,
    parameterKeys: [],
    parameterValues: [],
    pledgedSourceSize: NO_PLEDGED_SOURCE_SIZE,
  };
}

function openEngine(configuration: TransformConfiguration): number {
  const handle =
    configuration.family === "zlib"
      ? nts_zlib_create(
          configuration.mode,
          configuration.level,
          configuration.windowBits,
          configuration.memLevel,
          configuration.strategy,
          configuration.dictionary,
          false,
        )
      : nts_zlib_create_params(
          configuration.mode,
          configuration.parameterKeys,
          configuration.parameterValues,
          configuration.dictionary,
          configuration.pledgedSourceSize,
          false,
        );
  if (handle < 0) {
    throw new IteratorZlibError(
      "Failed to initialize the compression engine",
      handle,
      zlibCodeForStatus(handle),
    );
  }
  return handle;
}

async function nativeWrite(
  handle: number,
  flush: number,
  bytes: Uint8Array,
  outputLimit: number,
  signal: StreamAbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted!();
  const operation = nts_zlib_write(handle, flush, bytes, outputLimit);
  const aborted = Promise.withResolvers<never>();
  const onAbort = (): void => aborted.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    const output = await Promise.race([operation, aborted.promise]);
    const status = nts_zlib_status(handle);
    if (status !== 0) {
      throw new IteratorZlibError(
        nts_zlib_error_message(handle),
        status,
        nts_zlib_error_code(handle) || zlibCodeForStatus(status),
      );
    }
    return Buffer.from(output);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

const emptyNativeInput = new Uint8Array(0);


interface AsyncCompressionTransform {
  readonly [kValidatedTransform]: true;
  transform(source: AsyncTransformSource, options: TransformOptions): AsyncGenerator<ByteBatch>;
}

function makeAsyncCompressionTransform(mode: number, engineOptions: IteratorEngineOptions): AsyncCompressionTransform {
  const descriptor = {
    __proto__: null,
    [kValidatedTransform]: true as const,
    transform: async function*(source: AsyncTransformSource, options: TransformOptions): AsyncGenerator<ByteBatch> {
      const signal = options.signal;
      signal?.throwIfAborted!();
      const configuration = parseConfiguration(mode, engineOptions);
      const handle = openEngine(configuration);
      const chunkSize = configuration.chunkSize;
      let outOffset = 0;
      let pending: ByteBatch = [];
      let pendingBytes = 0;
      let writeFlush = configuration.processFlag;
      let iter: AsyncIterator<ByteBatch | null> | undefined;
      let returnMethod: AsyncIterator<ByteBatch | null>["return"];

      // nts_zlib_write owns pending native input between bounded writes. The
      // loop and false/true completion signal match onWriteComplete upstream.
      async function continueInputAsync(input: Uint8Array = emptyNativeInput): Promise<boolean> {
        while (true) {
          const output = await nativeWrite(handle, writeFlush, input, chunkSize - outOffset, signal);
          if (output.byteLength > 0) {
            pending.push(output);
            pendingBytes += output.byteLength;
            outOffset += output.byteLength;
          }
          if (outOffset >= chunkSize) outOffset = 0;
          if (!nts_zlib_operation_pending(handle)) return true;
          if (pendingBytes >= BATCH_HWM) return false;
          input = emptyNativeInput;
        }
      }

      function processInputAsync(input: Uint8Array, flush: number): Promise<boolean> {
        writeFlush = flush;
        return continueInputAsync(input);
      }

      function drainBatch(): ByteBatch {
        if (pendingBytes <= BATCH_HWM) {
          const batch = pending;
          pending = [];
          pendingBytes = 0;
          return batch;
        }
        const batch: ByteBatch = [];
        let batchBytes = 0;
        while (pending.length > 0 && batchBytes < BATCH_HWM) {
          const buffer = pending.shift()!;
          batch.push(buffer);
          batchBytes += buffer.byteLength;
          pendingBytes -= buffer.byteLength;
        }
        return batch;
      }

      async function* processInputBatches(input: Uint8Array, flush: number): AsyncGenerator<ByteBatch> {
        let complete = await processInputAsync(input, flush);
        while (!complete) {
          while (pendingBytes >= BATCH_HWM) yield drainBatch();
          signal?.throwIfAborted!();
          complete = await continueInputAsync();
        }
      }

      let finalized = false;
      // The numeric native handle is owned even if iterator method lookup fails.
      try {
        iter = source[Symbol.asyncIterator]();
        const sourceIterator = iter;
        const nextMethod = iter.next;
        try { returnMethod = iter.return; } catch { /* Ignore cleanup lookup failures. */ }

        function readNext(): Promise<IteratorResult<ByteBatch | null>> {
          const result = Promise.resolve(nextMethod.call(sourceIterator)).then(undefined, undefined);
          nts_zlib_mark_promise_handled(result);
          return result;
        }

        let nextResult = readNext();
        while (true) {
          const { value: chunks, done } = await nextResult;
          if (done) break;
          signal?.throwIfAborted!();
          if (chunks === null) {
            if (!finalized) {
              finalized = true;
              for await (const batch of processInputBatches(emptyNativeInput, configuration.finishFlag)) {
                yield batch;
              }
              while (pending.length > 0) yield drainBatch();
            }
            nextResult = readNext();
            continue;
          }
          nextResult = readNext();
          for (let i = 0; i < chunks.length; i++) {
            for await (const batch of processInputBatches(chunks[i]!, configuration.processFlag)) {
              yield batch;
            }
          }
          if (pendingBytes >= BATCH_HWM) {
            while (pending.length > 0 && pendingBytes >= BATCH_HWM) yield drainBatch();
          }
          if (pending.length > 0) yield drainBatch();
        }
        if (!finalized && !signal.aborted) {
          finalized = true;
          for await (const batch of processInputBatches(emptyNativeInput, configuration.finishFlag)) {
            yield batch;
          }
          while (pending.length > 0) yield drainBatch();
        }
      } finally {
        nts_zlib_close(handle);
        // return() can be queued behind a next() that never resolves.
        if (typeof returnMethod === "function") {
          try {
            const cleanup = Promise.resolve(returnMethod.call(iter)).then(undefined, undefined);
            nts_zlib_mark_promise_handled(cleanup);
          } catch { /* Cleanup cannot replace completion. */ }
        }
      }
    },
  };
  return descriptor;
}

interface SyncCompressionTransform {
  transform(source: SyncTransformSource): Generator<ByteBatch>;
}

function makeSyncCompressionTransform(mode: number, engineOptions: IteratorEngineOptions): SyncCompressionTransform {
  const descriptor = {
    __proto__: null,
    transform: function*(source: SyncTransformSource): Generator<ByteBatch> {
      const configuration = parseConfiguration(mode, engineOptions);
      const handle = openEngine(configuration);
      let pending: ByteBatch = [];
      let pendingBytes = 0;
      const writeState = new Uint32Array(2);
      let outBuf = Buffer.allocUnsafe(configuration.chunkSize);
      let outOffset = 0;

      function writeSync(
        input: Uint8Array, flush: number, inOff: number,
        availIn: number, availOutBefore: number,
      ): void {
        nts_zlib_write_into_sync(
          handle, flush, input, inOff, availIn,
          outBuf, outOffset, availOutBefore, writeState,
        );
        const status = nts_zlib_status(handle);
        if (status !== 0) {
          throw new IteratorZlibError(
            nts_zlib_error_message(handle), status,
            nts_zlib_error_code(handle) || zlibCodeForStatus(status),
          );
        }
      }

      // Node v26.13.0 internal/streams/iter/transform.js:607-667.
      function processSyncInput(input: Uint8Array, flush: number): void {
        let inOff = 0;
        let availIn = input.byteLength;
        let availOutBefore = configuration.chunkSize - outOffset;
        writeSync(input, flush, inOff, availIn, availOutBefore);
        while (true) {
          const availOut = writeState[0]!;
          const availInAfter = writeState[1]!;
          const have = availOutBefore - availOut;
          const bufferExhausted = availOut === 0 ||
            outOffset + have >= configuration.chunkSize;
          if (have > 0) {
            if (bufferExhausted && outOffset === 0) {
              pending.push(outBuf);
            } else if (bufferExhausted) {
              pending.push(outBuf.subarray(outOffset, outOffset + have));
            } else {
              pending.push(Uint8Array.prototype.slice.call(outBuf, outOffset, outOffset + have));
            }
            pendingBytes += have;
            outOffset += have;
          }
          if (bufferExhausted) {
            outBuf = Buffer.allocUnsafe(configuration.chunkSize);
            outOffset = 0;
          }
          if (availOut === 0) {
            const consumed = availIn - availInAfter;
            inOff += consumed;
            availIn = availInAfter;
            availOutBefore = configuration.chunkSize - outOffset;
            writeSync(input, flush, inOff, availIn, availOutBefore);
            continue;
          }
          break;
        }
      }

      function drainBatch(): ByteBatch {
        if (pendingBytes <= BATCH_HWM) {
          const batch = pending;
          pending = [];
          pendingBytes = 0;
          return batch;
        }
        const batch: ByteBatch = [];
        let batchBytes = 0;
        while (pending.length > 0 && batchBytes < BATCH_HWM) {
          const buffer = pending.shift()!;
          batch.push(buffer);
          batchBytes += buffer.byteLength;
          pendingBytes -= buffer.byteLength;
        }
        return batch;
      }

      try {
        for (const batch of source) {
          if (batch === null) {
            processSyncInput(emptyNativeInput, configuration.finishFlag);
            while (pending.length > 0) yield drainBatch();
            continue;
          }
          for (let i = 0; i < batch.length; i++) {
            processSyncInput(batch[i]!, configuration.processFlag);
          }
          if (pendingBytes >= BATCH_HWM) {
            while (pending.length > 0 && pendingBytes >= BATCH_HWM) yield drainBatch();
          }
          if (pending.length > 0) yield drainBatch();
        }
      } finally {
        nts_zlib_close(handle);
      }
    },
  };
  return descriptor;
}

function asyncTransform(mode: number, options: IteratorEngineOptions): AsyncCompressionTransform {
  validateObject(options, "options");
  return makeAsyncCompressionTransform(mode, options);
}

function syncTransform(mode: number, options: IteratorEngineOptions): SyncCompressionTransform {
  validateObject(options, "options");
  return makeSyncCompressionTransform(mode, options);
}

export function compressGzip(options: IteratorZlibOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.GZIP, options);
}

export function compressDeflate(options: IteratorZlibOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.DEFLATE, options);
}

export function compressBrotli(options: IteratorBrotliOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.BROTLI_ENCODE, options);
}

export function compressZstd(options: IteratorZstdOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.ZSTD_COMPRESS, options);
}

export function decompressGzip(options: IteratorZlibOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.GUNZIP, options);
}

export function decompressDeflate(options: IteratorZlibOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.INFLATE, options);
}

export function decompressBrotli(options: IteratorBrotliOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.BROTLI_DECODE, options);
}

export function decompressZstd(options: IteratorZstdOptions = {}): AsyncCompressionTransform {
  return asyncTransform(C.ZSTD_DECOMPRESS, options);
}

export function compressGzipSync(options: IteratorZlibOptions = {}): SyncCompressionTransform {
  return syncTransform(C.GZIP, options);
}

export function compressDeflateSync(options: IteratorZlibOptions = {}): SyncCompressionTransform {
  return syncTransform(C.DEFLATE, options);
}

export function compressBrotliSync(options: IteratorBrotliOptions = {}): SyncCompressionTransform {
  return syncTransform(C.BROTLI_ENCODE, options);
}

export function compressZstdSync(options: IteratorZstdOptions = {}): SyncCompressionTransform {
  return syncTransform(C.ZSTD_COMPRESS, options);
}

export function decompressGzipSync(options: IteratorZlibOptions = {}): SyncCompressionTransform {
  return syncTransform(C.GUNZIP, options);
}

export function decompressDeflateSync(options: IteratorZlibOptions = {}): SyncCompressionTransform {
  return syncTransform(C.INFLATE, options);
}

export function decompressBrotliSync(
  options: IteratorBrotliOptions = {},
): SyncCompressionTransform {
  return syncTransform(C.BROTLI_DECODE, options);
}

export function decompressZstdSync(options: IteratorZstdOptions = {}): SyncCompressionTransform {
  return syncTransform(C.ZSTD_DECOMPRESS, options);
}
