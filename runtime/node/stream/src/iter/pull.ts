// Pull pipelines and writer sinks for Node v24.20.0 `node:stream/iter`.
// Consecutive stateless transforms are fused so each batch crosses one
// generator boundary, while each invocation still receives fresh options.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../../internal/errors.ts";
import {
  arrayBufferViewToUint8Array,
  from,
  fromSync,
  isPrimitiveChunk,
  isUint8ArrayBatch,
  normalizeAsyncValue,
  primitiveToUint8Array,
} from "./from.ts";
import {
  hasToAsyncStreamable,
  hasToStreamable,
  isValidatedSource,
  kValidatedTransform,
} from "./types.ts";
import {
  type AsyncWriter,
  type AsyncByteStream,
  type ByteBatch,
  isAsyncWriter,
  isAsyncIterable,
  isPromiseLike,
  isSyncWriter,
  isSyncIterable,
  type SyncWriter,
  type StreamAbortSignal,
  type SyncByteStream,
  throwIfAborted,
  toUint8Array,
  wrapError,
  yieldAbortable,
} from "./utils.ts";

interface StreamAbortController {
  readonly signal: StreamAbortSignal;
  abort(reason?: unknown): void;
}

interface StreamAbortControllerConstructor {
  new (): StreamAbortController;
}

declare const AbortController: StreamAbortControllerConstructor;

export interface TransformOptions {
  readonly signal: StreamAbortSignal;
  [name: string]: unknown;
}

export interface PullOptions {
  signal?: StreamAbortSignal;
}

export interface PipeOptions extends PullOptions {
  preventClose?: boolean;
  preventFail?: boolean;
}

type StatelessTransform = (
  chunks: ByteBatch | null,
  options?: TransformOptions,
) => unknown;

interface StatefulTransform {
  transform(source: unknown, options?: TransformOptions): unknown;
}

type Transform = StatelessTransform | StatefulTransform;

function isStatelessTransform(value: unknown): value is StatelessTransform {
  return typeof value === "function";
}

function isStatefulTransform(value: unknown): value is StatefulTransform {
  return value !== null &&
    typeof value === "object" &&
    "transform" in value &&
    typeof value.transform === "function";
}

function isTransform(value: unknown): value is Transform {
  return isStatelessTransform(value) || isStatefulTransform(value);
}

function isPullOptions(value: unknown): value is PipeOptions {
  return value !== null &&
    typeof value === "object" &&
    !("transform" in value) &&
    !("write" in value) &&
    !("writeSync" in value);
}

function validateSignal(signal: unknown): asserts signal is StreamAbortSignal | undefined {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
  }
}

function parsePullArguments(args: readonly unknown[]): {
  transforms: Transform[];
  options?: PullOptions;
} {
  let end = args.length;
  let options: PullOptions | undefined;
  const last = args[args.length - 1];
  if (isPullOptions(last)) {
    options = last;
    end--;
  }

  const transforms: Transform[] = [];
  for (let i = 0; i < end; i++) {
    const transform = args[i];
    if (!isTransform(transform)) {
      throw new ERR_INVALID_ARG_TYPE(
        `transforms[${i}]`,
        ["Function", "Object with transform()"],
        transform,
      );
    }
    transforms.push(transform);
  }
  return { transforms, options };
}

function* flattenSync(value: unknown): Generator<Uint8Array> {
  if (value instanceof Uint8Array) {
    yield value;
  } else if (typeof value === "string") {
    yield toUint8Array(value);
  } else if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    yield new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    yield arrayBufferViewToUint8Array(value);
  } else if (isSyncIterable(value)) {
    for (const item of value) yield* flattenSync(item);
  } else {
    throw new ERR_INVALID_ARG_TYPE(
      "value",
      ["Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Iterable"],
      value,
    );
  }
}

async function* flattenAsync(value: unknown): AsyncGenerator<Uint8Array> {
  if (isPromiseLike(value)) {
    yield* flattenAsync(await value);
  } else if (isAsyncIterable(value)) {
    for await (const item of value) yield* flattenAsync(item);
  } else {
    yield* flattenSync(value);
  }
}

function* processSyncResult(result: unknown): Generator<ByteBatch> {
  if (result === null) return;
  if (isUint8ArrayBatch(result)) {
    if (result.length > 0) yield result;
    return;
  }
  if (isPrimitiveChunk(result)) {
    yield [primitiveToUint8Array(result)];
    return;
  }
  if (isSyncIterable(result)) {
    const batch: ByteBatch = [];
    for (const item of result) {
      for (const chunk of flattenSync(item)) batch.push(chunk);
    }
    if (batch.length > 0) yield batch;
    return;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "result",
    ["null", "Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Array", "Iterable"],
    result,
  );
}

async function* processAsyncResult(result: unknown): AsyncGenerator<ByteBatch> {
  if (isPromiseLike(result)) {
    yield* processAsyncResult(await result);
    return;
  }
  if (result === null) return;
  if (isUint8ArrayBatch(result)) {
    if (result.length > 0) yield result;
    return;
  }
  if (isPrimitiveChunk(result)) {
    yield [primitiveToUint8Array(result)];
    return;
  }
  if (isAsyncIterable(result) || isSyncIterable(result)) {
    const batch: ByteBatch = [];
    if (isAsyncIterable(result)) {
      for await (const item of result) {
        for await (const chunk of flattenAsync(item)) batch.push(chunk);
      }
    } else {
      for (const item of result) {
        for (const chunk of flattenSync(item)) batch.push(chunk);
      }
    }
    if (batch.length > 0) yield batch;
    return;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "result",
    [
      "null",
      "Uint8Array",
      "string",
      "ArrayBuffer",
      "ArrayBufferView",
      "Array",
      "Iterable",
      "AsyncIterable",
      "Promise",
    ],
    result,
  );
}

function appendSyncResult(target: ByteBatch[], result: unknown): void {
  for (const batch of processSyncResult(result)) target.push(batch);
}

async function appendAsyncResult(target: ByteBatch[], result: unknown): Promise<void> {
  for await (const batch of processAsyncResult(result)) target.push(batch);
}

function normalizeCurrentBatch(value: unknown): ByteBatch {
  if (isUint8ArrayBatch(value)) return value;
  const result: ByteBatch = [];
  for (const batch of processSyncResult(value)) result.push(...batch);
  return result;
}

async function normalizeCurrentBatchAsync(value: unknown): Promise<ByteBatch> {
  if (isUint8ArrayBatch(value)) return value;
  const result: ByteBatch = [];
  for await (const batch of processAsyncResult(value)) result.push(...batch);
  return result;
}

function* applyStatelessSync(
  source: SyncByteStream,
  transforms: readonly StatelessTransform[],
): Generator<ByteBatch> {
  for (const chunks of source) {
    let current: unknown = chunks;
    for (let i = 0; i < transforms.length; i++) {
      const transform = transforms[i];
      if (transform === undefined) continue;
      current = transform(current === null ? null : normalizeCurrentBatch(current));
      if (current === null) break;
    }
    if (current !== null) yield* processSyncResult(current);
  }

  let pending: ByteBatch[] = [];
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (transform === undefined) continue;
    const next: ByteBatch[] = [];
    for (let j = 0; j < pending.length; j++) {
      appendSyncResult(next, transform(pending[j] ?? null));
    }
    appendSyncResult(next, transform(null));
    pending = next;
  }
  for (let i = 0; i < pending.length; i++) {
    const batch = pending[i];
    if (batch !== undefined) yield batch;
  }
}

function* withSyncFlush(source: SyncByteStream): Generator<ByteBatch | null> {
  yield* source;
  yield null;
}

function* applyStatefulSync(
  source: SyncByteStream,
  transform: StatefulTransform,
): Generator<ByteBatch> {
  const output = transform.transform(withSyncFlush(source));
  if (!isSyncIterable(output)) {
    throw new ERR_INVALID_ARG_TYPE("transform result", "Iterable", output);
  }
  for (const item of output) {
    if (item === null) continue;
    const batch: ByteBatch = [];
    for (const chunk of flattenSync(item)) batch.push(chunk);
    if (batch.length > 0) yield batch;
  }
}

function* createSyncPipeline(
  source: SyncByteStream,
  transforms: readonly Transform[],
): Generator<ByteBatch> {
  let current: SyncByteStream = source;
  let stateless: StatelessTransform[] = [];

  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (transform === undefined) continue;
    if (isStatefulTransform(transform)) {
      if (stateless.length > 0) {
        current = applyStatelessSync(current, stateless);
        stateless = [];
      }
      current = applyStatefulSync(current, transform);
    } else {
      stateless.push(transform);
    }
  }
  if (stateless.length > 0) current = applyStatelessSync(current, stateless);
  yield* current;
}

async function* withAsyncFlush(source: AsyncByteStream): AsyncGenerator<ByteBatch | null> {
  yield* source;
  yield null;
}

async function* applyStatelessAsync(
  source: AsyncByteStream,
  transforms: readonly StatelessTransform[],
  signal: StreamAbortSignal,
): AsyncGenerator<ByteBatch> {
  for await (const chunks of source) {
    let current: unknown = chunks;
    for (let i = 0; i < transforms.length; i++) {
      const transform = transforms[i];
      if (transform === undefined) continue;
      const options: TransformOptions = { signal };
      current = await transform(
        current === null ? null : await normalizeCurrentBatchAsync(current),
        options,
      );
      if (current === null) break;
    }
    if (current !== null) yield* processAsyncResult(current);
  }

  let pending: ByteBatch[] = [];
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (transform === undefined) continue;
    const next: ByteBatch[] = [];
    for (let j = 0; j < pending.length; j++) {
      const options: TransformOptions = { signal };
      await appendAsyncResult(next, transform(pending[j] ?? null, options));
    }
    const options: TransformOptions = { signal };
    await appendAsyncResult(next, transform(null, options));
    pending = next;
  }
  for (let i = 0; i < pending.length; i++) {
    const batch = pending[i];
    if (batch !== undefined) yield batch;
  }
}

async function* applyStatefulAsync(
  source: AsyncByteStream,
  transform: StatefulTransform,
  signal: StreamAbortSignal,
): AsyncGenerator<ByteBatch> {
  const options: TransformOptions = { signal };
  const handlesFlush = kValidatedTransform in transform && transform[kValidatedTransform] === true;
  const output = transform.transform(handlesFlush ? source : withAsyncFlush(source), options);
  if (!isAsyncIterable(output) && !isSyncIterable(output)) {
    throw new ERR_INVALID_ARG_TYPE("transform result", ["Iterable", "AsyncIterable"], output);
  }
  if (isAsyncIterable(output)) {
    for await (const item of output) {
      if (item !== null) yield* processAsyncResult(item);
    }
  } else {
    for (const item of output) {
      if (item !== null) yield* processAsyncResult(item);
    }
  }
  if (handlesFlush) throwIfAborted(signal);
}

async function* createAsyncPipeline(
  source: AsyncByteStream,
  transforms: readonly Transform[],
  userSignal?: StreamAbortSignal,
): AsyncGenerator<ByteBatch> {
  if (userSignal !== undefined) throwIfAborted(userSignal);
  if (transforms.length === 0) {
    yield* yieldAbortable(source, userSignal);
    return;
  }

  const controller = new AbortController();
  const onUserAbort = (): void => controller.abort(userSignal?.reason ?? new AbortError());
  if (userSignal !== undefined) userSignal.addEventListener("abort", onUserAbort, { once: true });

  let current: AsyncByteStream = yieldAbortable(source, userSignal);
  let stateless: StatelessTransform[] = [];
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (transform === undefined) continue;
    if (isStatefulTransform(transform)) {
      if (stateless.length > 0) {
        current = applyStatelessAsync(current, stateless, controller.signal);
        stateless = [];
      }
      current = applyStatefulAsync(current, transform, controller.signal);
    } else {
      stateless.push(transform);
    }
  }
  if (stateless.length > 0) {
    current = applyStatelessAsync(current, stateless, controller.signal);
  }

  let completed = false;
  try {
    for await (const batch of current) {
      throwIfAborted(controller.signal);
      yield batch;
    }
    completed = true;
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(wrapError(error));
    throw error;
  } finally {
    if (!completed && !controller.signal.aborted) controller.abort(new AbortError());
    if (userSignal !== undefined) userSignal.removeEventListener("abort", onUserAbort);
  }
}

class SyncPipeline implements SyncByteStream {
  readonly #source: unknown;
  readonly #transforms: Transform[];
  constructor(source: unknown, transforms: Transform[]) {
    this.#source = source;
    this.#transforms = transforms;
  }
  *[Symbol.iterator](): Generator<ByteBatch> {
    yield* createSyncPipeline(fromSync(this.#source), this.#transforms);
  }
}

class AsyncPipeline implements AsyncByteStream {
  readonly #source: unknown;
  readonly #transforms: Transform[];
  readonly #signal?: StreamAbortSignal;
  constructor(source: unknown, transforms: Transform[], signal?: StreamAbortSignal) {
    this.#source = source;
    this.#transforms = transforms;
    this.#signal = signal;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<ByteBatch> {
    yield* createAsyncPipeline(from(this.#source), this.#transforms, this.#signal);
  }
}

class RejectedAsyncPipeline implements AsyncByteStream {
  readonly #reason: unknown;
  constructor(reason: unknown) {
    this.#reason = reason;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<ByteBatch> {
    throw this.#reason;
  }
}

export function pullSync(source: unknown, ...values: unknown[]): SyncByteStream {
  const transforms: Transform[] = [];
  for (let i = 0; i < values.length; i++) {
    const transform = values[i];
    if (!isTransform(transform)) {
      throw new ERR_INVALID_ARG_TYPE(
        `transforms[${i}]`,
        ["Function", "Object with transform()"],
        transform,
      );
    }
    transforms.push(transform);
  }
  return new SyncPipeline(source, transforms);
}

export function pull(source: unknown, ...args: unknown[]): AsyncByteStream {
  const parsed = parsePullArguments(args);
  const signal = parsed.options?.signal;
  validateSignal(signal);
  if (signal?.aborted) return new RejectedAsyncPipeline(signal.reason);
  return new AsyncPipeline(source, parsed.transforms, signal);
}

function parsePipeArguments(args: readonly unknown[], sync: boolean): {
  transforms: Transform[];
  writer: AsyncWriter | SyncWriter;
  options?: PipeOptions;
} {
  if (args.length === 0) {
    throw new ERR_INVALID_ARG_VALUE("args", args, "pipeTo requires a writer argument");
  }
  let writerIndex = args.length - 1;
  let options: PipeOptions | undefined;
  const last = args[writerIndex];
  if (isPullOptions(last) && !(sync ? isSyncWriter(last) : isAsyncWriter(last))) {
    options = last;
    writerIndex--;
  }
  const candidate = args[writerIndex];
  let writer: AsyncWriter | SyncWriter;
  if (sync) {
    if (!isSyncWriter(candidate)) {
      throw new ERR_INVALID_ARG_TYPE("writer", "object with a writeSync method", candidate);
    }
    writer = candidate;
  } else {
    if (!isAsyncWriter(candidate)) {
      throw new ERR_INVALID_ARG_TYPE("writer", "object with a write method", candidate);
    }
    writer = candidate;
  }
  const transforms: Transform[] = [];
  for (let i = 0; i < writerIndex; i++) {
    const transform = args[i];
    if (!isTransform(transform)) {
      throw new ERR_INVALID_ARG_TYPE(
        `transforms[${i}]`,
        ["Function", "Object with transform()"],
        transform,
      );
    }
    transforms.push(transform);
  }
  return { transforms, writer, options };
}

export function pipeToSync(source: unknown, ...args: unknown[]): number {
  const parsed = parsePipeArguments(args, true);
  if (!isSyncWriter(parsed.writer)) {
    throw new ERR_INVALID_ARG_TYPE("writer", "object with a writeSync method", parsed.writer);
  }
  const writer = parsed.writer;
  const stream = parsed.transforms.length === 0
    ? fromSync(source)
    : createSyncPipeline(fromSync(source), parsed.transforms);
  let totalBytes = 0;

  try {
    for (const batch of stream) {
      if (writer.writevSync !== undefined && batch.length > 1) {
        if (writer.writevSync(batch) === false) {
          throw new ERR_OUT_OF_RANGE("write", "within byte budget", "budget exhausted");
        }
        for (let i = 0; i < batch.length; i++) totalBytes += batch[i]?.byteLength ?? 0;
      } else {
        for (let i = 0; i < batch.length; i++) {
          const chunk = batch[i];
          if (chunk === undefined) continue;
          if (writer.writeSync(chunk) === false) {
            throw new ERR_OUT_OF_RANGE("write", "within byte budget", "budget exhausted");
          }
          totalBytes += chunk.byteLength;
        }
      }
    }
    if (!parsed.options?.preventClose) {
      if (writer.endSync === undefined || writer.endSync() < 0) writer.end?.();
    }
  } catch (error) {
    if (!parsed.options?.preventFail) writer.fail?.(wrapError(error));
    throw error;
  }
  return totalBytes;
}

async function writeAsyncBatch(
  writer: AsyncWriter,
  batch: ByteBatch,
  signal: StreamAbortSignal | undefined,
): Promise<number> {
  let total = 0;
  const options = signal === undefined ? undefined : { signal };
  if (writer.writev !== undefined && batch.length > 1) {
    if (writer.writevSync === undefined || !writer.writevSync(batch)) {
      await writer.writev(batch, options);
    }
    for (let i = 0; i < batch.length; i++) total += batch[i]?.byteLength ?? 0;
    return total;
  }
  for (let i = 0; i < batch.length; i++) {
    const chunk = batch[i];
    if (chunk === undefined) continue;
    if (writer.writeSync === undefined || !writer.writeSync(chunk)) {
      await writer.write(chunk, options);
    }
    total += chunk.byteLength;
  }
  return total;
}

export async function pipeTo(source: unknown, ...args: unknown[]): Promise<number> {
  const parsed = parsePipeArguments(args, false);
  if (!isAsyncWriter(parsed.writer)) {
    throw new ERR_INVALID_ARG_TYPE("writer", "object with a write method", parsed.writer);
  }
  const writer = parsed.writer;
  const signal = parsed.options?.signal;
  validateSignal(signal);
  if (signal !== undefined) throwIfAborted(signal);
  const incrementalSyncSource =
    signal === undefined &&
    parsed.transforms.length === 0 &&
    !isPrimitiveChunk(source) &&
    !Array.isArray(source) &&
    isSyncIterable(source) &&
    !isAsyncIterable(source) &&
    !isValidatedSource(source) &&
    !hasToStreamable(source) &&
    !hasToAsyncStreamable(source);
  const stream = incrementalSyncSource
    ? undefined
    : parsed.transforms.length === 0
      ? from(source)
      : createAsyncPipeline(from(source), parsed.transforms, signal);
  let totalBytes = 0;

  try {
    if (incrementalSyncSource && isSyncIterable(source)) {
      for (const value of source) {
        if (isUint8ArrayBatch(value)) {
          if (value.length > 0) totalBytes += await writeAsyncBatch(writer, value, signal);
        } else if (value instanceof Uint8Array) {
          totalBytes += await writeAsyncBatch(writer, [value], signal);
        } else {
          const batch: ByteBatch = [];
          for await (const chunk of normalizeAsyncValue(value)) batch.push(chunk);
          if (batch.length > 0) totalBytes += await writeAsyncBatch(writer, batch, signal);
        }
      }
    } else if (stream !== undefined) {
      for await (const batch of yieldAbortable(stream, signal)) {
        if (signal !== undefined) throwIfAborted(signal);
        totalBytes += await writeAsyncBatch(writer, batch, signal);
      }
    }
    if (!parsed.options?.preventClose) {
      if (writer.endSync === undefined || writer.endSync() < 0) {
        await writer.end?.(signal === undefined ? undefined : { signal });
      }
    }
  } catch (error) {
    if (!parsed.options?.preventFail) await writer.fail?.(wrapError(error));
    throw error;
  }
  return totalBytes;
}
