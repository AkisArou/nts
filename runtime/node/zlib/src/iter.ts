// `node:zlib/iter`, from Node v24.20.0
// `lib/internal/streams/iter/transform.js`.
//
// These descriptors drive the compression engine directly. They deliberately
// do not construct a classic Transform stream: iterator pipelines already
// provide ordering and backpressure, so an EventEmitter layer would only add
// allocations and callbacks around the same native operation.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import type { TransformOptions } from "../../stream/src/iter/pull.ts";
import { kValidatedTransform } from "../../stream/src/iter/types.ts";
import {
  type AsyncByteStream,
  type ByteBatch,
  type StreamAbortSignal,
  throwIfAborted,
} from "../../stream/src/iter/utils.ts";
import { Buffer } from "../../buffer/src/main.ts";
import * as C from "./constants.ts";
import { optionalByteView, parameterArrays } from "./options.ts";

const DEFAULT_OUTPUT_SIZE = 65_536;
const NO_PLEDGED_SOURCE_SIZE = -1;
const MAXIMUM_ONE_SHOT_OUTPUT = 0xffff_ffff;

type EngineFamily = "zlib" | "brotli" | "zstd";
type SyncTransformSource = Iterable<ByteBatch | null>;

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

function chunkSizeProperty(options: object): unknown {
  return "chunkSize" in options ? options.chunkSize : undefined;
}

function dictionaryProperty(options: object): unknown {
  return "dictionary" in options ? options.dictionary : undefined;
}

function paramsProperty(options: object): unknown {
  return "params" in options ? options.params : undefined;
}

function pledgedSourceSizeProperty(options: object): unknown {
  return "pledgedSrcSize" in options ? options.pledgedSrcSize : undefined;
}

function windowBitsProperty(options: object): unknown {
  return "windowBits" in options ? options.windowBits : undefined;
}

function levelProperty(options: object): unknown {
  return "level" in options ? options.level : undefined;
}

function memLevelProperty(options: object): unknown {
  return "memLevel" in options ? options.memLevel : undefined;
}

function strategyProperty(options: object): unknown {
  return "strategy" in options ? options.strategy : undefined;
}

function numberInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (value < minimum || value > maximum) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${minimum} and <= ${maximum}`, value);
  }
  return value;
}

function outputSize(options: object): number {
  const value = chunkSizeProperty(options);
  if (value === undefined) return DEFAULT_OUTPUT_SIZE;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ERR_INVALID_ARG_TYPE("options.chunkSize", "number", value);
  }
  if (value < C.Z_MIN_CHUNK) {
    throw new ERR_OUT_OF_RANGE("options.chunkSize", `>= ${C.Z_MIN_CHUNK}`, value);
  }
  return value;
}

function brotliParameters(
  mode: number,
  options: object,
): [number[], number[]] {
  const params = paramsProperty(options);
  const [userKeys, userValues] = parameterArrays(params, C.BROTLI_PARAM_NDIRECT, "brotli");
  if (mode !== C.BROTLI_ENCODE) return [userKeys, userValues];

  // Defaults precede user values so a repeated key has Node's last-write-wins
  // semantics when the native parameter table is initialized.
  const keys = new Array<number>(userKeys.length + 2);
  const values = new Array<number>(userValues.length + 2);
  keys[0] = C.BROTLI_PARAM_QUALITY;
  values[0] = 6;
  keys[1] = C.BROTLI_PARAM_LGWIN;
  values[1] = 20;
  for (let i = 0; i < userKeys.length; i++) {
    keys[i + 2] = userKeys[i] ?? 0;
    values[i + 2] = userValues[i] ?? 0;
  }
  return [keys, values];
}

function zstdParameters(
  mode: number,
  options: object,
): [number[], number[]] {
  const params = paramsProperty(options);
  return parameterArrays(
    params,
    mode === C.ZSTD_COMPRESS ? 402 : C.ZSTD_d_windowLogMax,
    "zstd",
  );
}

function pledgedSourceSize(mode: number, options: object): number {
  if (mode !== C.ZSTD_COMPRESS) return NO_PLEDGED_SOURCE_SIZE;
  const value = pledgedSourceSizeProperty(options);
  if (value === undefined) return NO_PLEDGED_SOURCE_SIZE;
  validateInteger(value, "options.pledgedSrcSize", 0);
  return value;
}

function parseConfiguration(mode: number, options: object): TransformConfiguration {
  const chunkSize = outputSize(options);
  const dictionary = optionalByteView(dictionaryProperty(options), "options.dictionary");

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

  const windowBitsValue = windowBitsProperty(options);
  let windowBits: number;
  if (
    windowBitsValue === 0 &&
    (mode === C.INFLATE || mode === C.GUNZIP)
  ) {
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
    level: numberInRange(
      levelProperty(options),
      "options.level",
      C.Z_MIN_LEVEL,
      C.Z_MAX_LEVEL,
      4,
    ),
    windowBits,
    memLevel: numberInRange(
      memLevelProperty(options),
      "options.memLevel",
      C.Z_MIN_MEMLEVEL,
      C.Z_MAX_MEMLEVEL,
      9,
    ),
    strategy: numberInRange(
      strategyProperty(options),
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
  const handle = configuration.family === "zlib"
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
    const code = C.codes[String(handle)];
    throw new IteratorZlibError(
      "Failed to initialize the compression engine",
      handle,
      typeof code === "string" ? code : "Z_UNKNOWN",
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
  throwIfAborted(signal);
  const operation = nts_zlib_write(handle, flush, bytes, outputLimit);
  let rejectAbort: (reason?: unknown) => void = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort(signal.reason ?? new AbortError());
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    const output = await Promise.race([operation, aborted]);
    const status = nts_zlib_status(handle);
    if (status !== 0) {
      const fallbackCode = C.codes[String(status)];
      throw new IteratorZlibError(
        nts_zlib_error_message(handle),
        status,
        nts_zlib_error_code(handle) ||
          (typeof fallbackCode === "string" ? fallbackCode : "Z_UNKNOWN"),
      );
    }
    return Buffer.from(output);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function* nativeOutput(
  handle: number,
  flush: number,
  bytes: Uint8Array,
  chunkSize: number,
  signal: StreamAbortSignal,
): AsyncGenerator<ByteBatch> {
  let input = bytes;
  do {
    const output = await nativeWrite(handle, flush, input, chunkSize, signal);
    if (output.byteLength > 0) yield [output];
    input = emptyNativeInput;
  } while (nts_zlib_operation_pending(handle));
}

const emptyNativeInput = new Uint8Array(0);

function* outputBatches(
  output: Uint8Array,
  chunkSize: number,
): Generator<ByteBatch> {
  for (let offset = 0; offset < output.byteLength; offset += chunkSize) {
    yield [output.subarray(offset, Math.min(offset + chunkSize, output.byteLength))];
  }
}

function concatenateSource(source: SyncTransformSource): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (const batch of source) {
    if (batch === null) continue;
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (chunk === undefined) continue;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function oneShot(
  configuration: TransformConfiguration,
  input: Uint8Array,
): Uint8Array {
  const output = configuration.family === "zlib"
    ? nts_zlib_oneshot(
      configuration.mode,
      configuration.level,
      configuration.windowBits,
      configuration.memLevel,
      configuration.strategy,
      configuration.dictionary,
      configuration.finishFlag,
      MAXIMUM_ONE_SHOT_OUTPUT,
      input,
      false,
    )
    : nts_zlib_oneshot_params(
      configuration.mode,
      configuration.parameterKeys,
      configuration.parameterValues,
      configuration.dictionary,
      configuration.pledgedSourceSize,
      configuration.finishFlag,
      MAXIMUM_ONE_SHOT_OUTPUT,
      input,
      false,
    );
  const status = nts_zlib_last_status();
  if (status !== 0) {
    const fallbackCode = C.codes[String(status)];
    throw new IteratorZlibError(
      nts_zlib_last_error_message(),
      status,
      nts_zlib_last_error_code() ||
        (typeof fallbackCode === "string" ? fallbackCode : "Z_UNKNOWN"),
    );
  }
  return Buffer.from(output);
}

class AsyncCompressionTransform {
  readonly [kValidatedTransform] = true;
  readonly #mode: number;
  readonly #options: object;

  constructor(mode: number, options: object) {
    this.#mode = mode;
    this.#options = options;
  }

  async *transform(
    source: AsyncByteStream,
    options: TransformOptions,
  ): AsyncGenerator<ByteBatch> {
    const signal = options.signal;
    throwIfAborted(signal);
    const configuration = parseConfiguration(this.#mode, this.#options);
    const handle = openEngine(configuration);
    try {
      for await (const batch of source) {
        throwIfAborted(signal);
        for (let i = 0; i < batch.length; i++) {
          const chunk = batch[i];
          if (chunk === undefined) continue;
          yield* nativeOutput(
            handle,
            configuration.processFlag,
            chunk,
            configuration.chunkSize,
            signal,
          );
        }
      }
      yield* nativeOutput(
        handle,
        configuration.finishFlag,
        emptyNativeInput,
        configuration.chunkSize,
        signal,
      );
    } finally {
      nts_zlib_close(handle);
    }
  }
}

class SyncCompressionTransform {
  readonly #mode: number;
  readonly #options: object;

  constructor(mode: number, options: object) {
    this.#mode = mode;
    this.#options = options;
  }

  *transform(source: SyncTransformSource): Generator<ByteBatch> {
    const configuration = parseConfiguration(this.#mode, this.#options);
    yield* outputBatches(
      oneShot(configuration, concatenateSource(source)),
      configuration.chunkSize,
    );
  }
}

function asyncTransform(mode: number, options: unknown): AsyncCompressionTransform {
  validateObject(options, "options");
  return new AsyncCompressionTransform(mode, options);
}

function syncTransform(mode: number, options: unknown): SyncCompressionTransform {
  validateObject(options, "options");
  return new SyncCompressionTransform(mode, options);
}

export function compressGzip(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.GZIP, options);
}

export function compressDeflate(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.DEFLATE, options);
}

export function compressBrotli(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.BROTLI_ENCODE, options);
}

export function compressZstd(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.ZSTD_COMPRESS, options);
}

export function decompressGzip(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.GUNZIP, options);
}

export function decompressDeflate(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.INFLATE, options);
}

export function decompressBrotli(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.BROTLI_DECODE, options);
}

export function decompressZstd(options: unknown = {}): AsyncCompressionTransform {
  return asyncTransform(C.ZSTD_DECOMPRESS, options);
}

export function compressGzipSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.GZIP, options);
}

export function compressDeflateSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.DEFLATE, options);
}

export function compressBrotliSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.BROTLI_ENCODE, options);
}

export function compressZstdSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.ZSTD_COMPRESS, options);
}

export function decompressGzipSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.GUNZIP, options);
}

export function decompressDeflateSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.INFLATE, options);
}

export function decompressBrotliSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.BROTLI_DECODE, options);
}

export function decompressZstdSync(options: unknown = {}): SyncCompressionTransform {
  return syncTransform(C.ZSTD_DECOMPRESS, options);
}
