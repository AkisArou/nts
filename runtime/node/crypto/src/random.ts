// Random bytes, integers and UUIDs, from node v24.20.0
// `lib/internal/crypto/random.js`, over OpenSSL's CSPRNG
// (`src/crypto/crypto_random.cc`).
//
// Primes -- `generatePrime`, `checkPrime` -- are the same file in node and are
// OpenSSL's `BN_*`; they are not part of this module yet.

import { Buffer, kMaxLength } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import { domException } from "../../internal/dom-exception.ts";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { validateBoolean, validateFunction, validateNumber, validateObject } from "../../internal/validators.ts";
import {
  isAnyArrayBuffer,
  isArrayBufferView,
  isFloat16Array,
  isFloat32Array,
  isFloat64Array,
  isTypedArray,
} from "../../util/src/types.ts";
import { bytesOf, jobError } from "./util.ts";
import type { ByteSource } from "./util.ts";

const kMaxInt32 = 2 ** 31 - 1;
const kMaxPossibleLength = Math.min(kMaxLength, kMaxInt32);

function assertOffset(offset: unknown, elementSize: number, length: number): number {
  validateNumber(offset, "offset");
  const bytes = offset * elementSize;
  const maxLength = Math.min(length, kMaxPossibleLength);
  if (Number.isNaN(bytes) || bytes > maxLength || bytes < 0) {
    throw new ERR_OUT_OF_RANGE("offset", `>= 0 && <= ${maxLength}`, bytes);
  }
  return bytes >>> 0;
}

function assertSize(size: unknown, elementSize: number, offset: number, length: number): number {
  validateNumber(size, "size");
  const bytes = size * elementSize;
  if (Number.isNaN(bytes) || bytes > kMaxPossibleLength || bytes < 0) {
    throw new ERR_OUT_OF_RANGE("size", `>= 0 && <= ${kMaxPossibleLength}`, bytes);
  }
  if (bytes + offset > length) {
    throw new ERR_OUT_OF_RANGE("size + offset", `<= ${length}`, bytes + offset);
  }
  return bytes >>> 0;
}

/** Bytes per element, node's `buf.BYTES_PER_ELEMENT || 1`: 1 for a `DataView` or a buffer. */
function elementSizeOf(buf: ByteSource): number {
  return isTypedArray(buf) ? buf.BYTES_PER_ELEMENT : 1;
}

function checkBuffer(buf: unknown): asserts buf is ByteSource {
  if (!isAnyArrayBuffer(buf) && !isArrayBufferView(buf)) {
    throw new ERR_INVALID_ARG_TYPE("buf", ["ArrayBuffer", "ArrayBufferView"], buf);
  }
}

/** A failed fill, as node's `DeriveBitsJob` reports one. */
const FILL_FAILED = "Deriving bits failed";

function fillSync(bytes: Uint8Array, offset: number, size: number): void {
  if (!nts_crypto_random_fill(bytes, offset, size)) throw jobError(FILL_FAILED);
}

/** A fill on the thread pool, reported as node's `RANDOMBYTESREQUEST`. */
function fillJob(bytes: Uint8Array, offset: number, size: number, done: (error: Error | null) => void): void {
  const request = new AsyncRequest("RANDOMBYTESREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_random_fill_job(bytes, offset, size, (ok) => {
    const error = ok ? null : jobError(FILL_FAILED);
    request.complete(() => done(error));
  });
}

export function randomBytes(size: unknown): Buffer;
export function randomBytes(size: unknown, callback: (error: Error | null, buf?: Buffer) => void): void;
export function randomBytes(
  size: unknown,
  callback?: (error: Error | null, buf?: Buffer) => void,
): Buffer | void {
  const bytes = assertSize(size, 1, 0, Infinity);
  if (callback !== undefined) validateFunction(callback, "callback");
  const buf = Buffer.allocUnsafe(bytes);
  if (callback === undefined) {
    if (bytes > 0) fillSync(buf, 0, bytes);
    return buf;
  }
  randomFill(buf, 0, bytes, (error) => {
    if (error) {
      callback(error);
      return;
    }
    callback(null, buf);
  });
}

export function randomFillSync<T extends ByteSource>(buf: T, offset?: number, size?: number): T;
export function randomFillSync(buf: ByteSource, offset?: unknown, size?: unknown): ByteSource {
  checkBuffer(buf);
  const bytes = bytesOf(buf);
  const elementSize = elementSizeOf(buf);
  const from = assertOffset(offset === undefined ? 0 : offset, elementSize, bytes.byteLength);
  const count = size === undefined ? bytes.byteLength - from : assertSize(size, elementSize, from, bytes.byteLength);
  if (count === 0) return buf;
  fillSync(bytes, from, count);
  return buf;
}

type FillCallback<T> = (error: Error | null, buf?: T) => void;

export function randomFill<T extends ByteSource>(buf: T, callback: FillCallback<T>): void;
export function randomFill<T extends ByteSource>(buf: T, offset: number, callback: FillCallback<T>): void;
export function randomFill<T extends ByteSource>(
  buf: T,
  offset: number,
  size: number,
  callback: FillCallback<T>,
): void;
export function randomFill(
  buf: ByteSource,
  offsetOrCallback?: unknown,
  sizeOrCallback?: unknown,
  maybeCallback?: unknown,
): void {
  checkBuffer(buf);
  const bytes = bytesOf(buf);
  const elementSize = elementSizeOf(buf);
  let offset = offsetOrCallback;
  let size = sizeOrCallback;
  let callback = maybeCallback;
  // Node reads `buf.length` here, not a byte length: with the callback second
  // or third, `size` is elements, which `assertSize` scales. Only a typed array
  // has a `length`, so a `DataView` or a buffer reads `undefined` -- and then
  // `undefined - offset`, which is NaN and a range error rather than a guess.
  const length = isTypedArray(buf) ? bytes.byteLength / elementSize : undefined;
  if (typeof offsetOrCallback === "function") {
    callback = offsetOrCallback;
    offset = 0;
    size = length;
  } else if (typeof sizeOrCallback === "function") {
    callback = sizeOrCallback;
    size = length !== undefined && typeof offset === "number" ? length - offset : Number.NaN;
  } else {
    validateFunction(callback, "callback");
  }
  const done = callback as FillCallback<ByteSource>;

  const from = assertOffset(offset, elementSize, bytes.byteLength);
  const count = size === undefined ? bytes.byteLength - from : assertSize(size, elementSize, from, bytes.byteLength);
  if (count === 0) {
    done(null, buf);
    return;
  }
  fillJob(bytes, from, count, (error) => {
    if (error) {
      done(error);
      return;
    }
    done(null, buf);
  });
}

// Largest integer we can read from a buffer.
// e.g.: Buffer.from("ff".repeat(6), "hex").readUIntBE(0, 6);
const RAND_MAX = 0xffff_ffff_ffff;

// Random data for `randomInt`, six bytes a draw, so the size is a multiple of
// six.
const randomCache = Buffer.allocUnsafe(6 * 1024);
let randomCacheOffset = randomCache.length;
let asyncCacheFillInProgress = false;

/** `randomInt`'s callback: node reports success with `undefined`, not `null`. */
type IntCallback = (error: Error | undefined, value?: number) => void;

interface PendingInt {
  min: number;
  max: number;
  callback: IntCallback;
}
const asyncCachePendingTasks: PendingInt[] = [];

/** An integer in [min, max), with `min` optional, synchronous without a callback. */
export function randomInt(max: number): number;
export function randomInt(min: number, max: number): number;
export function randomInt(max: number, callback: IntCallback): void;
export function randomInt(
  min: number,
  max: number,
  callback: IntCallback,
): void;
export function randomInt(first: unknown, second?: unknown, third?: unknown): number | void {
  let min = first;
  let max = second;
  let callback = third;
  const minNotSpecified = typeof second === "undefined" || typeof second === "function";
  if (minNotSpecified) {
    callback = second;
    max = first;
    min = 0;
  }

  const isSync = typeof callback === "undefined";
  if (!isSync) validateFunction(callback, "callback");
  if (!Number.isSafeInteger(min)) throw new ERR_INVALID_ARG_TYPE("min", "a safe integer", min);
  if (!Number.isSafeInteger(max)) throw new ERR_INVALID_ARG_TYPE("max", "a safe integer", max);
  const low = min as number;
  const high = max as number;
  if (high <= low) {
    throw new ERR_OUT_OF_RANGE("max", `greater than the value of "min" (${low})`, high);
  }

  // A random int in [0, range) first.
  const range = high - low;
  if (!(range <= RAND_MAX)) {
    throw new ERR_OUT_OF_RANGE(`max${minNotSpecified ? "" : " - min"}`, `<= ${RAND_MAX}`, range);
  }

  // For (x % range) to be unbiased, x must be drawn uniformly from
  // [0, randLimit).
  const randLimit = RAND_MAX - (RAND_MAX % range);

  // Synchronous, or asynchronous with data still cached: answered from the
  // cache, which is what makes this fast.
  while (isSync || randomCacheOffset < randomCache.length) {
    if (randomCacheOffset === randomCache.length) {
      // This might block the thread for a bit, but we are in sync mode.
      randomFillSync(randomCache);
      randomCacheOffset = 0;
    }
    const x = randomCache.readUIntBE(randomCacheOffset, 6);
    randomCacheOffset += 6;
    if (x < randLimit) {
      const n = (x % range) + low;
      if (isSync) return n;
      nextTick(deliverInt, callback as IntCallback, n);
      return;
    }
  }

  // Asynchronous with nothing cached. Another call may already be refilling,
  // so this one waits for that refill rather than starting a second.
  asyncCachePendingTasks.push({
    min: low,
    max: high,
    callback: callback as IntCallback,
  });
  asyncRefillRandomIntCache();
}

/** The cached answer, a tick later, as node's `process.nextTick(callback, undefined, n)`. */
function deliverInt(callback: IntCallback, n: number): void {
  callback(undefined, n);
}

function asyncRefillRandomIntCache(): void {
  if (asyncCacheFillInProgress) return;
  asyncCacheFillInProgress = true;
  randomFill(randomCache, (error) => {
    asyncCacheFillInProgress = false;
    const tasks = asyncCachePendingTasks;
    const errorReceiver = error ? tasks.shift() : undefined;
    if (!error) randomCacheOffset = 0;
    // Every waiting call is restarted; if the refill failed, one of them is
    // told, so each has a chance of succeeding.
    for (const task of tasks.splice(0)) randomInt(task.min, task.max, task.callback);
    // The only call that might throw, so it is last.
    if (errorReceiver !== undefined && error) errorReceiver.callback(error);
  });
}

/**
 * Web Crypto's `getRandomValues`: an integer typed array of at most 65,536
 * bytes, filled in place. Its errors are `DOMException`s because the Web
 * Crypto tests expect those.
 */
export function getRandomValues<T extends ArrayBufferView>(data: T): T;
export function getRandomValues(data: ArrayBufferView): ArrayBufferView {
  if (!isTypedArray(data) || isFloat16Array(data) || isFloat32Array(data) || isFloat64Array(data)) {
    throw domException("The data argument must be an integer-type TypedArray", "TypeMismatchError");
  }
  if (data.byteLength > 65536) {
    throw domException("The requested length exceeds 65,536 bytes", "QuotaExceededError");
  }
  randomFillSync(data, 0);
  return data;
}

// RFC 4122 identifiers, drawn in batches of 128 so that most calls take their
// sixteen bytes from a buffer filled earlier.
const kBatchSize = 128;
let uuidData: Buffer | undefined;
let uuidNotBuffered: Buffer | undefined;
let uuidBatch = 0;

let hexBytesCache: string[] | undefined;
function getHexBytes(): string[] {
  if (hexBytesCache === undefined) {
    hexBytesCache = new Array<string>(256);
    for (let i = 0; i < hexBytesCache.length; i++) {
      hexBytesCache[i] = i.toString(16).padStart(2, "0");
    }
  }
  return hexBytesCache;
}

function serializeUUID(buf: Uint8Array, version: number, variant: number, offset = 0): string {
  const kHexBytes = getHexBytes();
  // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return (
    kHexBytes[buf[offset]!]! +
    kHexBytes[buf[offset + 1]!]! +
    kHexBytes[buf[offset + 2]!]! +
    kHexBytes[buf[offset + 3]!]! +
    "-" +
    kHexBytes[buf[offset + 4]!]! +
    kHexBytes[buf[offset + 5]!]! +
    "-" +
    kHexBytes[(buf[offset + 6]! & 0x0f) | version]! +
    kHexBytes[buf[offset + 7]!]! +
    "-" +
    kHexBytes[(buf[offset + 8]! & 0x3f) | variant]! +
    kHexBytes[buf[offset + 9]!]! +
    "-" +
    kHexBytes[buf[offset + 10]!]! +
    kHexBytes[buf[offset + 11]!]! +
    kHexBytes[buf[offset + 12]!]! +
    kHexBytes[buf[offset + 13]!]! +
    kHexBytes[buf[offset + 14]!]! +
    kHexBytes[buf[offset + 15]!]!
  );
}

/**
 * Node's `secureBuffer`, which allocates from OpenSSL's secure heap when
 * `--secure-heap` gave it one and from the ordinary heap otherwise. This
 * profile has no secure heap, so it is always the second -- which is also
 * node's default.
 */
function secureBuffer(size: number): Buffer {
  return Buffer.alloc(size);
}

function getBufferedUUID(): string {
  uuidData ??= secureBuffer(16 * kBatchSize);
  if (uuidBatch === 0) randomFillSync(uuidData);
  uuidBatch = (uuidBatch + 1) % kBatchSize;
  return serializeUUID(uuidData, 0x40, 0x80, uuidBatch * 16);
}

function getUnbufferedUUID(): string {
  uuidNotBuffered ??= secureBuffer(16);
  randomFillSync(uuidNotBuffered);
  return serializeUUID(uuidNotBuffered, 0x40, 0x80);
}

interface UUIDOptions {
  disableEntropyCache?: boolean;
}

function entropyCacheDisabled(options: unknown): boolean {
  if (options !== undefined) validateObject(options, "options");
  const disableEntropyCache = options === undefined ? false : ((options as UUIDOptions).disableEntropyCache ?? false);
  validateBoolean(disableEntropyCache, "options.disableEntropyCache");
  return disableEntropyCache;
}

export function randomUUID(options?: UUIDOptions): string {
  return entropyCacheDisabled(options) ? getUnbufferedUUID() : getBufferedUUID();
}

/** The first six bytes of a version-7 UUID: milliseconds since the epoch, big-endian. */
function writeTimestamp(buf: Uint8Array, offset: number): void {
  const now = Date.now();
  const msb = now / 2 ** 32;
  buf[offset] = msb >>> 8;
  buf[offset + 1] = msb;
  buf[offset + 2] = now >>> 24;
  buf[offset + 3] = now >>> 16;
  buf[offset + 4] = now >>> 8;
  buf[offset + 5] = now;
}

function getBufferedUUIDv7(): string {
  uuidData ??= secureBuffer(16 * kBatchSize);
  if (uuidBatch === 0) randomFillSync(uuidData);
  uuidBatch = (uuidBatch + 1) % kBatchSize;
  const offset = uuidBatch * 16;
  writeTimestamp(uuidData, offset);
  return serializeUUID(uuidData, 0x70, 0x80, offset);
}

function getUnbufferedUUIDv7(): string {
  uuidNotBuffered ??= secureBuffer(16);
  randomFillSync(uuidNotBuffered, 6);
  writeTimestamp(uuidNotBuffered, 0);
  return serializeUUID(uuidNotBuffered, 0x70, 0x80);
}

export function randomUUIDv7(options?: UUIDOptions): string {
  return entropyCacheDisabled(options) ? getUnbufferedUUIDv7() : getBufferedUUIDv7();
}
