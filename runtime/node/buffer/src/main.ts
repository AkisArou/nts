// `node:buffer`, from node v24.20.0 `lib/buffer.js`.
//
// `Buffer` is a `Uint8Array` with an encoding-aware API on top, and that is
// literally true: node's is a subclass, so every `Uint8Array` method works on
// one and a `Buffer` is accepted anywhere a `Uint8Array` is. Subclassing rather
// than wrapping is the whole design, because it is what makes a `Buffer`
// passable to any API that takes bytes.
//
// The numeric accessors are written as byte arithmetic rather than through a
// `DataView`. That is upstream's choice and it is the right one here too: a
// `DataView` is an object per access, and these are the functions a protocol
// parser calls in its inner loop.

import {
  ERR_BUFFER_OUT_OF_BOUNDS,
  ERR_INVALID_BUFFER_SIZE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_STATE,
  ERR_OUT_OF_RANGE,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";
import {
  byteLengthIn,
  decodeIn,
  isEncoding as isEncodingName,
  normalizeEncoding,
  normalizeEncodingName,
  writeIn,
  type Encoding,
} from "./encodings.ts";
import { validateInteger } from "../../internal/validators.ts";
import { emitWarning } from "../../internal/process-warning.ts";

export { Blob, File, resolveObjectURL } from "./blob.ts";

export { isEncodingName as isEncoding };

/** Node's cap on a single buffer, and what `alloc` compares against. */
/**
 * The largest a `Buffer` may be.
 *
 * `2**53 - 1` on a 64-bit build, which is not an amount of memory anyone has:
 * it is the largest integer a `double` indexes exactly, and node reports the
 * representational limit rather than an allocatable one. A 32-bit build
 * reports `2**30 - 1`.
 */
export const kMaxLength = 2 ** 53 - 1;
export const kStringMaxLength = 536870888;
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: kStringMaxLength };
/** How many bytes `inspect` shows before it says how many are left. */
export const INSPECT_MAX_BYTES = 50;

function checkEncoding(encoding: unknown): Encoding {
  if (encoding === undefined) {
    return "utf8";
  }
  if (typeof encoding !== "string") {
    throw new ERR_INVALID_ARG_TYPE("encoding", "string", encoding);
  }
  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) {
    throw new ERR_UNKNOWN_ENCODING(encoding);
  }
  return normalized;
}

/** `Buffer.byteLength` alone treats an unknown spelling as UTF-8. */
function byteLengthEncoding(encoding: unknown): Encoding {
  if (encoding === undefined || encoding === "") return "utf8";
  if (typeof encoding !== "string") {
    throw new ERR_INVALID_ARG_TYPE("encoding", "string", encoding);
  }
  return normalizeEncoding(encoding) ?? "utf8";
}

function checkSize(size: unknown): number {
  if (typeof size !== "number") {
    throw new ERR_INVALID_ARG_TYPE("size", "number", size);
  }
  // Typed-array construction performs ToLength, so finite fractional sizes
  // are truncated (for example 3.3 becomes 3), matching Node.
  if (Number.isNaN(size) || size < 0 || size > kMaxLength) {
    throw new ERR_OUT_OF_RANGE("size", `>= 0 && <= ${kMaxLength}`, size);
  }
  return size;
}

/**
 * One to six bytes: the widest signed integer a `double` holds exactly.
 *
 * Seven would round silently, which is why this is a validated argument rather
 * than a documented convention.
 */
/** An index into a buffer of `length` bytes, inclusive of the end. */
function checkOffset(value: unknown, name: string, max = kMaxLength): number {
  validateInteger(value, name, 0, max);
  return value;
}

/** Node's numeric normalization for the optional indices accepted by copy. */
function copyInteger(value: number, fallback: number): number {
  if (Number.isInteger(value)) return value;
  if (Number.isFinite(value) && Number.isSafeInteger(Math.floor(value))) {
    return Math.floor(value);
  }
  return fallback;
}

/** Primitive-only numeric conversion; intentionally never invokes object hooks. */
function primitiveNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "boolean") return Number(value);
  if (value === null) return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 0;
    if (
      value.length === 1 &&
      (typeof value[0] === "number" || typeof value[0] === "string")
    ) {
      return Number(value[0]);
    }
  }
  return Number.NaN;
}

function stringSliceIndex(value: unknown, fallback: number, length: number): number {
  if (value === undefined) return fallback;
  const numeric = primitiveNumber(value);
  if (Number.isNaN(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= length) return length;
  return Math.trunc(numeric);
}

function rawStringWrite(
  target: Uint8Array,
  value: unknown,
  offset: unknown,
  length: unknown,
  encoding: Encoding,
): number {
  if (typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE("string", "string", value);
  }
  if (
    typeof offset !== "number" || typeof length !== "number" ||
    !Number.isInteger(offset) || !Number.isInteger(length) ||
    offset < 0 || length < 0 || offset + length > target.length
  ) {
    throw new ERR_BUFFER_OUT_OF_BOUNDS();
  }
  return writeIn(target, value, offset, length, encoding);
}

/** A `Buffer` or a plain `Uint8Array`; the methods do not distinguish them. */
/**
 * `fromObject`, upstream `lib/buffer.js`.
 *
 * Two shapes, and `undefined` for anything else so the caller can keep trying.
 *
 * The first is array-like, and the test is deliberately loose: *either* a
 * `length` or a `.buffer` that is an array buffer. That second clause is why
 * `Buffer.from(new DataView(...))` is empty rather than an error -- a view has
 * a `buffer` and no `length`, so it qualifies and then contributes nothing.
 * Surprising, and node's.
 *
 * The second is `{ type: "Buffer", data: [...] }`, which is what `toJSON`
 * produces, so a buffer survives `JSON.parse(JSON.stringify(buf))`.
 */
interface UnknownArrayLike {
  readonly length: unknown;
  readonly [index: number]: unknown;
}

/** The byte-addressable common shape of typed arrays, excluding DataView. */
interface TypedArrayView extends ArrayBufferView<ArrayBuffer> {
  readonly length: number;
  readonly BYTES_PER_ELEMENT: number;
}

function isTypedArrayView(value: unknown): value is TypedArrayView {
  return ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    value.buffer instanceof ArrayBuffer &&
    "length" in value && typeof value.length === "number" &&
    "BYTES_PER_ELEMENT" in value && typeof value.BYTES_PER_ELEMENT === "number";
}

function hasArrayLikeShape(value: object): value is UnknownArrayLike {
  return "length" in value;
}

function objectToBuffer(value: object): Buffer | undefined {
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) return new Buffer(0);
    if (!hasArrayLikeShape(value)) return new Buffer(0);
    return fromArrayLike(value);
  }
  if (hasArrayLikeShape(value)) {
    return fromArrayLike(value);
  }
  if (
    "type" in value && value.type === "Buffer" &&
    "data" in value && Array.isArray(value.data)
  ) {
    return fromArrayLike(value.data);
  }
  return undefined;
}

/** One byte per element, truncating each. Not the memory a view sits on. */
function fromArrayLike(source: UnknownArrayLike): Buffer {
  if (typeof source.length !== "number") return new Buffer(0);
  const size = source.length;
  const buf = new Buffer(size >= 0 ? size : 0);
  for (let i = 0; i < buf.length; i++) {
    // The compiled language has no Symbol.toPrimitive/valueOf hook. Keep the
    // JavaScript boundary on the same primitive-only conversion path as fill.
    buf[i] = primitiveNumber(source[i]) & 0xff;
  }
  return buf;
}

function checkBytes(value: unknown, name: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "Uint8Array"], value);
  }
}

function checkBufferList(value: unknown): asserts value is readonly Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE("list", "Array", value);
  }
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    checkBytes(item, `list[${i}]`);
  }
}

/**
 * The one place a bad index is reported, upstream `boundsError`.
 *
 * Three errors, and the distinctions are what a caller needs. Not a number at
 * all: the wrong kind of argument. A number that is not an integer: the right
 * kind, wrong value, and no range worth quoting because none of it is legal.
 * An integer past the end: the right kind and the range is useful. And a
 * negative `length` means the buffer is too short for the access at any
 * offset, so there is no legal offset to suggest and the buffer is what is
 * wrong.
 *
 * `type` names the argument; without one it is an offset, whose range starts
 * at 0 where a `byteLength`'s starts at 1.
 */
function boundsError(value: unknown, length: number, type?: string): never {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(type ?? "offset", "number", value);
  }
  if (Math.floor(value) !== value) {
    throw new ERR_OUT_OF_RANGE(type ?? "offset", "an integer", value);
  }
  if (length < 0) {
    throw new ERR_BUFFER_OUT_OF_BOUNDS();
  }
  throw new ERR_OUT_OF_RANGE(type ?? "offset", `>= ${type ? 1 : 0} and <= ${length}`, value);
}

/** Check that `size` bytes are readable at `offset`, and return the offset. */
function checkedOffset(bytes: Uint8Array, offset: unknown, size: number): number {
  const last = bytes.length - size;
  if (
    typeof offset === "number" &&
    offset >= 0 && offset <= last && Number.isInteger(offset)
  ) {
    return offset;
  }
  boundsError(offset, last);
}

/** Validate a fixed-width integer write and return its checked offset. */
function checkedIntegerWrite(
  bytes: Uint8Array,
  value: unknown,
  min: number,
  max: number,
  offset: unknown,
  size: number,
): number {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE("value", "number", value);
  }
  if (value > max || value < min) {
    let range: string;
    if (size > 4) {
      range = min === 0
        ? `>= 0 and < 2 ** ${size * 8}`
        : `>= -(2 ** ${size * 8 - 1}) and < 2 ** ${size * 8 - 1}`;
    } else {
      range = `>= ${min} and <= ${max}`;
    }
    throw new ERR_OUT_OF_RANGE("value", range, value);
  }
  return checkedOffset(bytes, offset, size);
}

/** Validate a 64-bit integer write and return its checked offset. */
function checkedBigIntWrite(
  bytes: Uint8Array,
  value: unknown,
  min: bigint,
  max: bigint,
  offset: unknown,
): number {
  if (typeof value !== "bigint") {
    throw new ERR_INVALID_ARG_TYPE("value", "bigint", value);
  }
  if (value > max || value < min) {
    const range = min === 0n
      ? ">= 0n and < 2n ** 64n"
      : ">= -(2n ** 63n) and < 2n ** 63n";
    throw new ERR_OUT_OF_RANGE("value", range, value);
  }
  return checkedOffset(bytes, offset, 8);
}

function checkByteLength(byteLength: number): number {
  if (byteLength >= 1 && byteLength <= 6 && Number.isInteger(byteLength)) {
    return byteLength;
  }
  boundsError(byteLength, 6, "byteLength");
}

export class Buffer extends Uint8Array {
  static poolSize = 8192;

  constructor(size: number);
  constructor(value: string, encoding?: string);
  constructor(array: ArrayLike<number>);
  constructor(buffer: ArrayBuffer, byteOffset?: number, length?: number);
  constructor(
    value: number | string | ArrayBuffer | ArrayLike<number>,
    encodingOrOffset?: string | number,
    length?: number,
  ) {
    if (typeof value === "number") {
      if (typeof encodingOrOffset === "string") {
        throw new ERR_INVALID_ARG_TYPE("string", "string", value);
      }
      super(checkSize(value));
      return;
    }
    if (typeof value === "string") {
      const encoding = checkEncoding(encodingOrOffset);
      const size = byteLengthIn(value, encoding);
      super(size);
      writeIn(this, value, 0, size, encoding);
      return;
    }
    if (value instanceof ArrayBuffer) {
      if (typeof encodingOrOffset === "string") {
        throw new ERR_INVALID_ARG_TYPE("offset", "number", encodingOrOffset);
      }
      super(value, encodingOrOffset, length);
      return;
    }
    super(value);
  }

  /** Legacy spelling retained by Node as an alias for `buffer`. */
  get parent(): ArrayBufferLike | undefined {
    if (!(this instanceof Buffer)) return undefined;
    return this.buffer;
  }

  /** Legacy spelling retained by Node as an alias for `byteOffset`. */
  get offset(): number | undefined {
    if (!(this instanceof Buffer)) return undefined;
    return this.byteOffset;
  }

  // ------------------------------------------------------------- allocation

  /** Zero-filled. Upstream `lib/buffer.js`. */
  static alloc(size: number, fill?: string | number | Uint8Array, encoding?: string): Buffer {
    const buf = new Buffer(checkSize(size));
    if (fill !== undefined && size > 0) {
      buf.fill(fill, 0, size, encoding);
    }
    return buf;
  }

  /**
   * Not zero-filled.
   *
   * Node hands back memory from a pool without clearing it, so the contents are
   * whatever was there. A `Uint8Array` is always zeroed, so ours is safe where
   * node's is not — the name is kept because the API is the contract, and code
   * that reads before writing is wrong either way.
   */
  static allocUnsafe(size: number): Buffer {
    return new Buffer(checkSize(size));
  }

  static allocUnsafeSlow(size: number): Buffer {
    return new Buffer(checkSize(size));
  }

  /**
   * Static-side compatibility required by `extends Uint8Array`.
   *
   * Node ignores the extra arguments for array-like inputs; unlike
   * `Uint8Array.from`, `Buffer.from` does not run a mapping callback. The
   * parameters are therefore `unknown`, not a falsely advertised callback.
   */
  static override from<T>(
    value: ArrayLike<T> | Iterable<T>,
    ignoredForStaticCompatibility?: unknown,
    ignoredThirdArgument?: unknown,
  ): Buffer;
  static override from(
    value: string | ArrayBuffer | ArrayLike<number> | Iterable<number> | Buffer,
    encodingOrOffset?: string | number,
    length?: number,
  ): Buffer;
  static override from(
    value: unknown,
    encodingOrOffset?: unknown,
    length?: unknown,
  ): Buffer {
    if (typeof value === "string") {
      if (encodingOrOffset !== undefined && typeof encodingOrOffset !== "string") {
        throw new ERR_INVALID_ARG_TYPE("encoding", "string", encodingOrOffset);
      }
      const encoding = checkEncoding(encodingOrOffset);
      const size = byteLengthIn(value, encoding);
      const buf = new Buffer(size);
      const written = writeIn(buf, value, 0, size, encoding);
      // Hex and base64 accept forgiving input. Their length calculation is an
      // allocation bound; invalid characters or early padding may make the
      // decoded value shorter than that bound.
      return written === size ? buf : buf.subarray(0, written);
    }

    if (value !== null && typeof value === "object") {
      if (value instanceof ArrayBuffer) {
        // A view onto the same memory, not a copy: upstream shares the buffer
        // so that a `Buffer` over one sees later writes to it.
        const backing = value;
        if (encodingOrOffset !== undefined && typeof encodingOrOffset !== "number") {
          throw new ERR_INVALID_ARG_TYPE("offset", "number", encodingOrOffset);
        }
        if (length !== undefined && typeof length !== "number") {
          throw new ERR_INVALID_ARG_TYPE("length", "number", length);
        }
        const offset = encodingOrOffset ?? 0;
        const count = length ?? backing.byteLength - offset;
        if (offset > backing.byteLength) {
          throw new ERR_BUFFER_OUT_OF_BOUNDS("offset");
        }
        if (count > backing.byteLength - offset) {
          throw new ERR_BUFFER_OUT_OF_BOUNDS("length");
        }
        return new Buffer(backing, offset, count);
      }

      const fromObject = objectToBuffer(value);
      if (fromObject !== undefined) {
        return fromObject;
      }
    }

    throw new ERR_INVALID_ARG_TYPE(
      "first argument",
      ["string", "Buffer", "ArrayBuffer", "Array", "Array-like Object"],
      value,
    );
  }

  static override of(...items: number[]): Buffer {
    return Buffer.from(items);
  }

  /** Copy the raw bytes occupied by a typed-array element range. */
  static copyBytesFrom(view: TypedArrayView, offset?: number, length?: number): Buffer;
  static copyBytesFrom(view: unknown, offset?: unknown, length?: unknown): Buffer {
    if (!isTypedArrayView(view)) {
      throw new ERR_INVALID_ARG_TYPE("view", "TypedArray", view);
    }
    if (view.length === 0) return new Buffer(0);

    let start = 0;
    if (offset !== undefined) {
      validateInteger(offset, "offset", 0);
      if (offset >= view.length) return new Buffer(0);
      start = offset;
    }

    let end = view.length;
    if (length !== undefined) {
      validateInteger(length, "length", 0);
      end = Math.min(start + length, view.length);
    }
    if (end <= start) return new Buffer(0);

    const byteOffset = view.byteOffset + start * view.BYTES_PER_ELEMENT;
    const byteLength = (end - start) * view.BYTES_PER_ELEMENT;
    return fromArrayLike(new Uint8Array(view.buffer, byteOffset, byteLength));
  }

  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  static concat(list: unknown, totalLength?: unknown): Buffer {
    checkBufferList(list);
    if (totalLength !== undefined) {
      validateInteger(totalLength, "length", 0, kMaxLength);
    }
    if (list.length === 0) {
      return new Buffer(0);
    }
    let total = totalLength;
    if (total === undefined) {
      total = 0;
      for (const item of list) {
        total += item.length;
      }
    }
    const out = Buffer.allocUnsafe(total);
    let at = 0;
    for (const item of list) {
      if (at >= total) break;
      // A list longer than `totalLength` is truncated, not an error: upstream
      // treats the length as the size of the result.
      const take = Math.min(item.length, total - at);
      out.set(item.subarray(0, take), at);
      at += take;
    }
    // A `totalLength` larger than the input leaves the tail zeroed.
    return out;
  }

  /** Whether `toString` and `write` would accept this name. */
  static isEncoding(encoding: unknown): boolean {
    return isEncodingName(encoding);
  }

  static isBuffer(value: unknown): value is Buffer {
    return value instanceof Buffer;
  }

  static byteLength(value: unknown, encoding?: string): number {
    if (typeof value === "string") {
      return byteLengthIn(value, byteLengthEncoding(encoding));
    }
    if (ArrayBuffer.isView(value)) {
      if (!(value.buffer instanceof ArrayBuffer)) {
        throw new ERR_INVALID_ARG_TYPE("string", ["string", "Buffer", "ArrayBuffer"], value);
      }
      return value.byteLength;
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }
    // Node names the parameter `string` even when the value is a buffer,
    // because that is the argument's name in the signature.
    throw new ERR_INVALID_ARG_TYPE("string", ["string", "Buffer", "ArrayBuffer"], value);
  }

  static compare(a: Uint8Array, b: Uint8Array): number {
    checkBytes(a, "buf1");
    checkBytes(b, "buf2");
    return compareBytes(a, 0, a.length, b, 0, b.length);
  }

  // ---------------------------------------------------------------- reading

  /** Upstream `lib/buffer.js`. */
  override toString(encoding?: string, start = 0, end = this.length): string {
    const codec = checkEncoding(encoding);
    const from = stringSliceIndex(start, 0, this.length);
    const to = stringSliceIndex(end, this.length, this.length);
    if (to <= from) return "";
    return decodeIn(this, from, to, codec);
  }

  override toLocaleString(): string {
    return decodeIn(this, 0, this.length, "utf8");
  }

  asciiSlice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "ascii");
  }

  base64Slice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "base64");
  }

  base64urlSlice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "base64url");
  }

  latin1Slice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "latin1");
  }

  hexSlice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "hex");
  }

  ucs2Slice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "ucs2");
  }

  utf8Slice(start = 0, end = this.length): string {
    return decodeIn(this, start, end, "utf8");
  }

  asciiWrite(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "ascii");
  }

  base64Write(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "base64");
  }

  base64urlWrite(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "base64url");
  }

  latin1Write(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "latin1");
  }

  hexWrite(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "hex");
  }

  ucs2Write(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "ucs2");
  }

  utf8Write(value: string, offset = 0, length = this.length - offset): number {
    return rawStringWrite(this, value, offset, length, "utf8");
  }

  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: Array.from(this) };
  }

  /** `<Buffer 78 79 7a>`, consumed directly and by `util.inspect`. */
  inspect(): string {
    const shown = Math.min(INSPECT_MAX_BYTES, this.length);
    const remaining = this.length - shown;
    let hex = "";
    for (let i = 0; i < shown; i++) {
      const byte = this[i];
      if (byte === undefined) break;
      hex += `${i > 0 ? " " : ""}${byte.toString(16).padStart(2, "0")}`;
    }
    if (remaining > 0) {
      hex += ` ... ${remaining} more byte${remaining > 1 ? "s" : ""}`;
    }
    return `<Buffer ${hex}>`;
  }

  /** Upstream `lib/buffer.js`. Bytes in, at `offset`, at most `length`. */
  write(str: string, encoding?: string): number;
  write(str: string, offset: number, length?: number, encoding?: string): number;
  write(
    str: unknown,
    offset?: number | string,
    length?: number | string,
    encoding?: string,
  ): number {
    if (typeof str !== "string") {
      throw new ERR_INVALID_ARG_TYPE("string", "string", str);
    }
    let at = 0;
    let max = this.length;
    let codec: string | undefined;

    // `write(str, encoding)`, `write(str, offset, encoding)` and the full form
    // all reach here; node distinguishes them by type rather than by arity.
    if (typeof offset === "string" && length === undefined) {
      codec = offset;
    } else if (offset !== undefined) {
      if (typeof offset !== "number") {
        throw new ERR_INVALID_ARG_TYPE("offset", "number", offset);
      }
      at = offset;
      if (typeof length === "string") {
        codec = length;
        max = this.length - at;
      } else if (length !== undefined) {
        max = Math.min(length, this.length - at);
        codec = encoding;
      } else {
        max = this.length - at;
      }
    }

    if (at < 0 || at > this.length) {
      throw new ERR_OUT_OF_RANGE("offset", `>= 0 && <= ${this.length}`, at);
    }
    return writeIn(this, str, at, Math.max(0, max), checkEncoding(codec));
  }

  // ------------------------------------------------------------- comparison

  equals(other: Uint8Array): boolean {
    if (!(other instanceof Uint8Array)) {
      throw new ERR_INVALID_ARG_TYPE("otherBuffer", ["Buffer", "Uint8Array"], other);
    }
    return compareBytes(this, 0, this.length, other, 0, other.length) === 0;
  }

  compare(
    target: Uint8Array,
    targetStart?: number,
    targetEnd?: number,
    sourceStart?: number,
    sourceEnd?: number,
  ): number {
    // Checked before the defaults are read, because `target.length` is one of
    // them and reading it off a string would answer rather than throw.
    checkBytes(target, "target");
    const ts = targetStart === undefined ? 0 : checkOffset(targetStart, "targetStart");
    const te = targetEnd === undefined
      ? target.length
      : checkOffset(targetEnd, "targetEnd", target.length);
    const ss = sourceStart === undefined ? 0 : checkOffset(sourceStart, "sourceStart");
    const se = sourceEnd === undefined
      ? this.length
      : checkOffset(sourceEnd, "sourceEnd", this.length);
    if (ss >= se) return ts >= te ? 0 : -1;
    if (ts >= te) return 1;
    return compareBytes(this, ss, se, target, ts, te);
  }

  // ---------------------------------------------------------------- copying

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    checkBytes(target, "target");
    const targetAt = copyInteger(targetStart, 0);
    if (targetAt < 0) {
      throw new ERR_OUT_OF_RANGE("targetStart", ">= 0", targetAt);
    }
    const from = copyInteger(sourceStart, 0);
    if (from < 0 || from > this.length) {
      throw new ERR_OUT_OF_RANGE("sourceStart", `>= 0 && <= ${this.length}`, from);
    }
    const requestedEnd = copyInteger(sourceEnd, 0);
    if (requestedEnd < 0) {
      throw new ERR_OUT_OF_RANGE("sourceEnd", ">= 0", requestedEnd);
    }
    if (targetAt >= target.length || from >= requestedEnd) {
      return 0;
    }
    const to = Math.min(requestedEnd, this.length);
    const room = target.length - targetAt;
    const n = Math.max(0, Math.min(to - from, room));
    if (n === 0) {
      return 0;
    }
    target.set(this.subarray(from, from + n), targetAt);
    return n;
  }

  override subarray(start?: number, end?: number): Buffer {
    // A view, not a copy — which is what `slice` means on a `Buffer` too, and
    // the difference from `Array.prototype.slice` that surprises people.
    const view = super.subarray(start, end);
    return new Buffer(view.buffer, view.byteOffset, view.byteLength);
  }

  override slice(start?: number, end?: number): Buffer {
    const view = super.subarray(start, end);
    return new Buffer(view.buffer, view.byteOffset, view.byteLength);
  }

  override fill(
    value: string | number | Uint8Array,
    offset?: number,
    end?: number,
    encoding?: string,
  ): this;
  override fill(
    value: string | number | Uint8Array,
    offset: number,
    encoding: string,
  ): this;
  override fill(value: string | number | Uint8Array, encoding: string): this;
  override fill(
    value: unknown = 0,
    offsetOrEncoding?: unknown,
    endOrEncoding?: unknown,
    explicitEncoding?: unknown,
  ): this {
    let offsetValue = offsetOrEncoding;
    let endValue = endOrEncoding;
    let encodingValue = explicitEncoding;
    let pattern: Uint8Array | undefined;
    let numericValue = 0;

    if (typeof value === "string") {
      if (offsetValue === undefined || typeof offsetValue === "string") {
        encodingValue = offsetValue;
        offsetValue = 0;
        endValue = this.length;
      } else if (typeof endValue === "string") {
        encodingValue = endValue;
        endValue = this.length;
      }

      const encoding = checkEncoding(encodingValue);
      if (value.length === 0) {
        numericValue = 0;
      } else {
        pattern = Buffer.from(value, encoding);
        // A non-empty string that decodes to no bytes is invalid (for example
        // `"zz"` in hex), while the empty string itself means a zero fill.
        if (pattern.length === 0) {
          throw new ERR_INVALID_ARG_VALUE("value", value);
        }
      }
    } else if (value instanceof Uint8Array) {
      pattern = value;
      if (pattern.length === 0) {
        throw new ERR_INVALID_ARG_VALUE("value", value);
      }
    } else {
      // The public typed surface accepts numbers. The small primitive-only
      // conversion preserves Node's JavaScript boundary behavior for null,
      // booleans and ordinary values without invoking user conversion hooks.
      numericValue = primitiveNumber(value);
    }

    let from: number;
    let to: number;
    if (offsetValue === undefined) {
      from = 0;
      to = this.length;
    } else {
      from = checkOffset(offsetValue, "offset");
      to = endValue === undefined
        ? this.length
        : checkOffset(endValue, "end", this.length);
      if (from >= to) return this;
    }

    if (pattern === undefined) {
      super.fill(numericValue, from, to);
      return this;
    }

    // Repeat the pattern, truncating the last copy: `fill("ab", 0, 5)` gives
    // `ababa`.
    for (let i = from; i < to; i++) {
      this[i] = pattern[(i - from) % pattern.length]!;
    }
    return this;
  }

  // ---------------------------------------------------------------- finding

  override indexOf(
    value: string | number | Uint8Array,
    byteOffset: number | string = 0,
    endOrEncoding?: number | string,
    encoding?: string,
  ): number {
    return search(this, value, byteOffset, endOrEncoding, encoding, true);
  }

  override lastIndexOf(
    value: string | number | Uint8Array,
    byteOffset?: number | string,
    endOrEncoding?: number | string,
    encoding?: string,
  ): number {
    return search(this, value, byteOffset, endOrEncoding, encoding, false);
  }

  override includes(
    value: string | number | Uint8Array,
    byteOffset: number | string = 0,
    endOrEncoding?: number | string,
    encoding?: string,
  ): boolean {
    return search(this, value, byteOffset, endOrEncoding, encoding, true) !== -1;
  }

  // ------------------------------------------------------------- byte order

  // ------------------------------------------- the variable-width family
  //
  // `readIntBE(offset, byteLength)` reads one to six bytes. Six because that is
  // the widest signed integer a double holds exactly, and reading seven would
  // silently round -- which is why the limit is a validated argument rather
  // than a documented convention.

  readUIntBE(offset: number, byteLength: number): number {
    const at = checkedOffset(this, offset, checkByteLength(byteLength));
    let value = 0;
    for (let i = 0; i < byteLength; i++) {
      value = value * 256 + this[at + i]!;
    }
    return value;
  }

  readUIntLE(offset: number, byteLength: number): number {
    const at = checkedOffset(this, offset, checkByteLength(byteLength));
    let value = 0;
    for (let i = byteLength - 1; i >= 0; i--) {
      value = value * 256 + this[at + i]!;
    }
    return value;
  }

  readIntBE(offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedOffset(this, offset, size);
    let value = 0;
    for (let i = 0; i < size; i++) {
      value = value * 256 + this[at + i]!;
    }
    // Sign-extend from the width actually read, by subtracting the modulus
    // when the top bit is set. Arithmetic rather than a shift, because a
    // six-byte value does not fit the 32-bit shift operators.
    const limit = 2 ** (size * 8 - 1);
    return value >= limit ? value - limit * 2 : value;
  }

  readIntLE(offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedOffset(this, offset, size);
    let value = 0;
    for (let i = size - 1; i >= 0; i--) {
      value = value * 256 + this[at + i]!;
    }
    const limit = 2 ** (size * 8 - 1);
    return value >= limit ? value - limit * 2 : value;
  }

  writeUIntBE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedIntegerWrite(this, value, 0, 2 ** (size * 8) - 1, offset, size);
    let rest = value;
    for (let i = size - 1; i >= 0; i--) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  writeUIntLE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedIntegerWrite(this, value, 0, 2 ** (size * 8) - 1, offset, size);
    let rest = value;
    for (let i = 0; i < size; i++) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  writeIntBE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const limit = 2 ** (size * 8 - 1);
    const at = checkedIntegerWrite(this, value, -limit, limit - 1, offset, size);
    let rest = value < 0 ? value + limit * 2 : value;
    for (let i = size - 1; i >= 0; i--) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  writeIntLE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const limit = 2 ** (size * 8 - 1);
    const at = checkedIntegerWrite(this, value, -limit, limit - 1, offset, size);
    let rest = value < 0 ? value + limit * 2 : value;
    for (let i = 0; i < size; i++) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  // ------------------------------------------------------ the 64-bit family
  //
  // `bigint` rather than `number`, because a `double` holds only 53 bits
  // exactly and a 64-bit integer read into one would be silently wrong for
  // half its range. That is the whole reason these methods exist.

  readBigUInt64BE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const hi = this[at]! * 2 ** 24 + this[at + 1]! * 2 ** 16 + this[at + 2]! * 2 ** 8 + this[at + 3]!;
    const lo = this[at + 4]! * 2 ** 24 + this[at + 5]! * 2 ** 16 + this[at + 6]! * 2 ** 8 + this[at + 7]!;
    return (BigInt(hi) << 32n) + BigInt(lo);
  }

  readBigUInt64LE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const lo = this[at]! + this[at + 1]! * 2 ** 8 + this[at + 2]! * 2 ** 16 + this[at + 3]! * 2 ** 24;
    const hi = this[at + 4]! + this[at + 5]! * 2 ** 8 + this[at + 6]! * 2 ** 16 + this[at + 7]! * 2 ** 24;
    return (BigInt(hi) << 32n) + BigInt(lo);
  }

  readBigInt64BE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const hi = this[at]! * 2 ** 24 + this[at + 1]! * 2 ** 16 + this[at + 2]! * 2 ** 8 + this[at + 3]!;
    const lo = this[at + 4]! * 2 ** 24 + this[at + 5]! * 2 ** 16 + this[at + 6]! * 2 ** 8 + this[at + 7]!;
    return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  }

  readBigInt64LE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const lo = this[at]! + this[at + 1]! * 2 ** 8 + this[at + 2]! * 2 ** 16 + this[at + 3]! * 2 ** 24;
    const hi = this[at + 4]! + this[at + 5]! * 2 ** 8 + this[at + 6]! * 2 ** 16 + this[at + 7]! * 2 ** 24;
    return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  }

  writeBigUInt64BE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, 0n, 0xffffffffffffffffn, offset);
    let rest = value;
    for (let i = 7; i >= 0; i--) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }

  writeBigUInt64LE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, 0n, 0xffffffffffffffffn, offset);
    let rest = value;
    for (let i = 0; i < 8; i++) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }

  writeBigInt64BE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, -(2n ** 63n), 2n ** 63n - 1n, offset);
    let rest = BigInt.asUintN(64, value);
    for (let i = 7; i >= 0; i--) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }

  writeBigInt64LE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, -(2n ** 63n), 2n ** 63n - 1n, offset);
    let rest = BigInt.asUintN(64, value);
    for (let i = 0; i < 8; i++) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }

  swap16(): this {
    if (this.length % 2 !== 0) {
      throw new ERR_INVALID_BUFFER_SIZE("16-bits");
    }
    for (let i = 0; i < this.length; i += 2) {
      const t = this[i]!;
      this[i] = this[i + 1]!;
      this[i + 1] = t;
    }
    return this;
  }

  swap32(): this {
    if (this.length % 4 !== 0) {
      throw new ERR_INVALID_BUFFER_SIZE("32-bits");
    }
    for (let i = 0; i < this.length; i += 4) {
      let t = this[i]!;
      this[i] = this[i + 3]!;
      this[i + 3] = t;
      t = this[i + 1]!;
      this[i + 1] = this[i + 2]!;
      this[i + 2] = t;
    }
    return this;
  }

  swap64(): this {
    if (this.length % 8 !== 0) {
      throw new ERR_INVALID_BUFFER_SIZE("64-bits");
    }
    for (let i = 0; i < this.length; i += 8) {
      for (let k = 0; k < 4; k++) {
        const t = this[i + k]!;
        this[i + k] = this[i + 7 - k]!;
        this[i + 7 - k] = t;
      }
    }
    return this;
  }

  // ------------------------------------------------------------- numerics

  readUInt8(offset = 0): number {
    return this[checkedOffset(this, offset, 1)]!;
  }

  readInt8(offset = 0): number {
    const v = this[checkedOffset(this, offset, 1)]!;
    return v & 0x80 ? v - 0x100 : v;
  }

  readUInt16LE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    return this[at]! | (this[at + 1]! << 8);
  }

  readUInt16BE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    return (this[at]! << 8) | this[at + 1]!;
  }

  readInt16LE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    const v = this[at]! | (this[at + 1]! << 8);
    return v & 0x8000 ? v - 0x10000 : v;
  }

  readInt16BE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    const v = (this[at]! << 8) | this[at + 1]!;
    return v & 0x8000 ? v - 0x10000 : v;
  }

  readUInt32LE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    // `>>> 0` because the shift makes it signed and this value is not.
    return ((this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16)) + this[at + 3]! * 0x1000000) >>> 0;
  }

  readUInt32BE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    return (this[at]! * 0x1000000 + ((this[at + 1]! << 16) | (this[at + 2]! << 8) | this[at + 3]!)) >>> 0;
  }

  readInt32LE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    return this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16) | (this[at + 3]! << 24);
  }

  readInt32BE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    return (this[at]! << 24) | (this[at + 1]! << 16) | (this[at + 2]! << 8) | this[at + 3]!;
  }

  writeUInt8(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xff, offset, 1);
    this[at] = value & 0xff;
    return at + 1;
  }

  writeInt8(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, -0x80, 0x7f, offset, 1);
    this[at] = value & 0xff;
    return at + 1;
  }

  writeUInt16LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffff, offset, 2);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    return at + 2;
  }

  writeUInt16BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffff, offset, 2);
    this[at] = (value >>> 8) & 0xff;
    this[at + 1] = value & 0xff;
    return at + 2;
  }

  writeInt16LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, -0x8000, 0x7fff, offset, 2);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    return at + 2;
  }

  writeInt16BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, -0x8000, 0x7fff, offset, 2);
    this[at] = (value >>> 8) & 0xff;
    this[at + 1] = value & 0xff;
    return at + 2;
  }

  writeUInt32LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffffffff, offset, 4);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    this[at + 2] = (value >>> 16) & 0xff;
    this[at + 3] = (value >>> 24) & 0xff;
    return at + 4;
  }

  writeUInt32BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffffffff, offset, 4);
    this[at] = (value >>> 24) & 0xff;
    this[at + 1] = (value >>> 16) & 0xff;
    this[at + 2] = (value >>> 8) & 0xff;
    this[at + 3] = value & 0xff;
    return at + 4;
  }

  writeInt32LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, -0x80000000, 0x7fffffff, offset, 4);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    this[at + 2] = (value >>> 16) & 0xff;
    this[at + 3] = (value >>> 24) & 0xff;
    return at + 4;
  }

  writeInt32BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, -0x80000000, 0x7fffffff, offset, 4);
    this[at] = (value >>> 24) & 0xff;
    this[at + 1] = (value >>> 16) & 0xff;
    this[at + 2] = (value >>> 8) & 0xff;
    this[at + 3] = value & 0xff;
    return at + 4;
  }

  // Floats go through a one-element typed array, because reproducing IEEE-754
  // rounding by hand is a way to be subtly wrong.
  readFloatLE(offset = 0): number {
    scratchBytes.set(this.subarray(checkedOffset(this, offset, 4), offset + 4));
    return scratchFloat[0]!;
  }

  readFloatBE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    for (let i = 0; i < 4; i++) scratchBytes[i] = this[at + 3 - i]!;
    return scratchFloat[0]!;
  }

  writeFloatLE(value: number, offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    scratchFloat[0] = value;
    for (let i = 0; i < 4; i++) this[at + i] = scratchBytes[i]!;
    return at + 4;
  }

  writeFloatBE(value: number, offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    scratchFloat[0] = value;
    for (let i = 0; i < 4; i++) this[at + i] = scratchBytes[3 - i]!;
    return at + 4;
  }

  readDoubleLE(offset = 0): number {
    const at = checkedOffset(this, offset, 8);
    for (let i = 0; i < 8; i++) scratchBytes8[i] = this[at + i]!;
    return scratchDouble[0]!;
  }

  readDoubleBE(offset = 0): number {
    const at = checkedOffset(this, offset, 8);
    for (let i = 0; i < 8; i++) scratchBytes8[i] = this[at + 7 - i]!;
    return scratchDouble[0]!;
  }

  writeDoubleLE(value: number, offset = 0): number {
    const at = checkedOffset(this, offset, 8);
    scratchDouble[0] = value;
    for (let i = 0; i < 8; i++) this[at + i] = scratchBytes8[i]!;
    return at + 8;
  }

  writeDoubleBE(value: number, offset = 0): number {
    const at = checkedOffset(this, offset, 8);
    scratchDouble[0] = value;
    for (let i = 0; i < 8; i++) this[at + i] = scratchBytes8[7 - i]!;
    return at + 8;
  }

  // Node exposes both UInt and Uint spellings. NTS needs both names in the
  // static class layout, so these hot bodies are deliberately duplicated:
  // forwarding aliases would add another call and runtime prototype aliasing
  // is a §13 non-goal. Observable function identity between the spellings is
  // outside the static profile; their behavior is identical.
  readUint8(offset = 0): number {
    return this[checkedOffset(this, offset, 1)]!;
  }

  readUint16BE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    return (this[at]! << 8) | this[at + 1]!;
  }

  readUint16LE(offset = 0): number {
    const at = checkedOffset(this, offset, 2);
    return this[at]! | (this[at + 1]! << 8);
  }

  readUint32BE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    return (this[at]! * 0x1000000 + ((this[at + 1]! << 16) | (this[at + 2]! << 8) | this[at + 3]!)) >>> 0;
  }

  readUint32LE(offset = 0): number {
    const at = checkedOffset(this, offset, 4);
    return ((this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16)) + this[at + 3]! * 0x1000000) >>> 0;
  }

  readUintBE(offset: number, byteLength: number): number {
    const at = checkedOffset(this, offset, checkByteLength(byteLength));
    let value = 0;
    for (let i = 0; i < byteLength; i++) {
      value = value * 256 + this[at + i]!;
    }
    return value;
  }

  readUintLE(offset: number, byteLength: number): number {
    const at = checkedOffset(this, offset, checkByteLength(byteLength));
    let value = 0;
    for (let i = byteLength - 1; i >= 0; i--) {
      value = value * 256 + this[at + i]!;
    }
    return value;
  }

  readBigUint64BE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const hi = this[at]! * 2 ** 24 + this[at + 1]! * 2 ** 16 + this[at + 2]! * 2 ** 8 + this[at + 3]!;
    const lo = this[at + 4]! * 2 ** 24 + this[at + 5]! * 2 ** 16 + this[at + 6]! * 2 ** 8 + this[at + 7]!;
    return (BigInt(hi) << 32n) + BigInt(lo);
  }

  readBigUint64LE(offset = 0): bigint {
    const at = checkedOffset(this, offset, 8);
    const lo = this[at]! + this[at + 1]! * 2 ** 8 + this[at + 2]! * 2 ** 16 + this[at + 3]! * 2 ** 24;
    const hi = this[at + 4]! + this[at + 5]! * 2 ** 8 + this[at + 6]! * 2 ** 16 + this[at + 7]! * 2 ** 24;
    return (BigInt(hi) << 32n) + BigInt(lo);
  }

  writeUint8(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xff, offset, 1);
    this[at] = value & 0xff;
    return at + 1;
  }

  writeUint16BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffff, offset, 2);
    this[at] = (value >>> 8) & 0xff;
    this[at + 1] = value & 0xff;
    return at + 2;
  }

  writeUint16LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffff, offset, 2);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    return at + 2;
  }

  writeUint32BE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffffffff, offset, 4);
    this[at] = (value >>> 24) & 0xff;
    this[at + 1] = (value >>> 16) & 0xff;
    this[at + 2] = (value >>> 8) & 0xff;
    this[at + 3] = value & 0xff;
    return at + 4;
  }

  writeUint32LE(value: number, offset = 0): number {
    const at = checkedIntegerWrite(this, value, 0, 0xffffffff, offset, 4);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    this[at + 2] = (value >>> 16) & 0xff;
    this[at + 3] = (value >>> 24) & 0xff;
    return at + 4;
  }

  writeUintBE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedIntegerWrite(this, value, 0, 2 ** (size * 8) - 1, offset, size);
    let rest = value;
    for (let i = size - 1; i >= 0; i--) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  writeUintLE(value: number, offset: number, byteLength: number): number {
    const size = checkByteLength(byteLength);
    const at = checkedIntegerWrite(this, value, 0, 2 ** (size * 8) - 1, offset, size);
    let rest = value;
    for (let i = 0; i < size; i++) {
      this[at + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    return at + size;
  }

  writeBigUint64BE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, 0n, 0xffffffffffffffffn, offset);
    let rest = value;
    for (let i = 7; i >= 0; i--) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }

  writeBigUint64LE(value: bigint, offset = 0): number {
    const at = checkedBigIntWrite(this, value, 0n, 0xffffffffffffffffn, offset);
    let rest = value;
    for (let i = 0; i < 8; i++) {
      this[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return at + 8;
  }
}

const scratchFloat = new Float32Array(1);
const scratchBytes = new Uint8Array(scratchFloat.buffer);
const scratchDouble = new Float64Array(1);
const scratchBytes8 = new Uint8Array(scratchDouble.buffer);

/** Lexicographic, then by length. Node's `Buffer.compare` contract. */
function compareBytes(
  a: Uint8Array, aStart: number, aEnd: number,
  b: Uint8Array, bStart: number, bEnd: number,
): number {
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  const n = Math.min(aLen, bLen);
  for (let i = 0; i < n; i++) {
    const x = a[aStart + i]!;
    const y = b[bStart + i]!;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  if (aLen === bLen) return 0;
  return aLen < bLen ? -1 : 1;
}

/** `indexOf` and `lastIndexOf` over bytes, a string, or one byte value. */
function search(
  haystack: Buffer,
  value: string | number | Uint8Array,
  byteOffset: number | string | undefined,
  endOrEncoding: number | string | undefined,
  explicitEncoding: string | undefined,
  forward: boolean,
): number {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !ArrayBuffer.isView(value)
  ) {
    throw new ERR_INVALID_ARG_TYPE("value", ["number", "string", "Buffer", "Uint8Array"], value);
  }
  let encoding = explicitEncoding;
  let end = haystack.length;
  if (typeof endOrEncoding === "string") {
    encoding = endOrEncoding;
  } else if (endOrEncoding !== undefined) {
    end = normalizeSearchEnd(endOrEncoding, haystack.length);
  }

  if (typeof byteOffset === "string") {
    encoding = byteOffset;
    byteOffset = undefined;
  }
  const fromOffset = normalizeSearchOffset(byteOffset, haystack.length, forward);

  if (typeof value === "number") {
    const needle = value & 0xff;
    if (forward) {
      for (let i = fromOffset; i < end; i++) {
        if (haystack[i] === needle) return i;
      }
    } else {
      for (let i = Math.min(fromOffset, end - 1); i >= 0; i--) {
        if (haystack[i] === needle) return i;
      }
    }
    return -1;
  }

  const needle =
    typeof value === "string" ? Buffer.from(value, checkEncoding(encoding)) : value;
  if (needle.length === 0) {
    return Math.min(Math.max(0, fromOffset), end);
  }
  if (needle.length > end) {
    return -1;
  }

  const last = end - needle.length;
  const unit = isUcs2Search(encoding) ? 2 : 1;
  if (unit === 2 && needle.length < 2) return -1;
  let from = forward ? fromOffset : Math.min(fromOffset, last);
  if (unit === 2) {
    from -= from % 2;
  }
  const step = forward ? unit : -unit;
  for (let i = from; forward ? i <= last : i >= 0; i += step) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function normalizeSearchOffset(
  value: unknown,
  length: number,
  forward: boolean,
): number {
  let offset: number;
  if (typeof value === "number") {
    offset = value;
  } else if (value === null) {
    offset = 0;
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      offset = 0;
    } else if (
      value.length === 1 &&
      (typeof value[0] === "number" || typeof value[0] === "string")
    ) {
      offset = Number(value[0]);
    } else {
      offset = Number.NaN;
    }
  } else {
    // Ordinary objects become NaN in Node's coercing boundary. Deliberately
    // do not invoke valueOf or Symbol.toPrimitive: those hooks are §13
    // metaobject behavior.
    offset = Number.NaN;
  }
  if (Number.isNaN(offset)) {
    return forward ? 0 : length;
  }
  if (offset === Infinity) return length;
  if (offset === -Infinity) return forward ? 0 : -1;
  offset = Math.trunc(offset);
  if (offset < 0) return Math.max(length + offset, forward ? 0 : -1);
  return Math.min(offset, length);
}

function normalizeSearchEnd(value: number, length: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Infinity) return length;
  if (value === -Infinity) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), length);
}

function isUcs2Search(encoding: string | undefined): boolean {
  const normalized = normalizeEncoding(encoding);
  return normalized === "ucs2" || normalized === "ucs-2" ||
    normalized === "utf16le" || normalized === "utf-16le";
}

/**
 * `SlowBuffer`, upstream `lib/buffer.js`. Deprecated since v4 and still
 * exported, so still part of the surface.
 *
 * A plain function rather than a class: node's is callable without `new`, and
 * every use of it in the wild predates `class`.
 */
export function SlowBuffer(length: number): Buffer {
  if (!slowBufferWarningEmitted) {
    slowBufferWarningEmitted = true;
    emitWarning(
      "SlowBuffer() is deprecated. Please use Buffer.allocUnsafeSlow()",
      "DeprecationWarning",
      "DEP0030",
    );
  }
  return Buffer.allocUnsafeSlow(length);
}

let slowBufferWarningEmitted = false;

/**
 * Whether every byte is valid UTF-8, upstream `lib/buffer.js`.
 *
 * A *validator*, not a decoder: it answers without building a string, which is
 * the point of having it at all.
 */
export function isUtf8(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = asBytes(input, "input");
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      i += 1;
      continue;
    }
    let needed: number;
    let code: number;
    let lowest: number;
    if ((b0 & 0xe0) === 0xc0) {
      needed = 1; code = b0 & 0x1f; lowest = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      needed = 2; code = b0 & 0x0f; lowest = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      needed = 3; code = b0 & 0x07; lowest = 0x10000;
    } else {
      return false;
    }
    if (i + needed >= bytes.length + 1) {
      return false;
    }
    for (let k = 1; k <= needed; k++) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) {
        return false;
      }
      code = (code << 6) | (b & 0x3f);
    }
    // Overlong, a surrogate, or past the last code point: well-formed bytes
    // for a value UTF-8 may not carry.
    if (code < lowest || (code >= 0xd800 && code < 0xe000) || code > 0x10ffff) {
      return false;
    }
    i += needed + 1;
  }
  return true;
}

/** The bytes of a buffer or an `ArrayBuffer`, or an error naming both. */
function asBytes(input: unknown, name: string): Uint8Array {
  if (input instanceof ArrayBuffer) {
    // A transferred buffer still answers `instanceof` and has no bytes behind
    // it; reading one is a mistake about lifetime rather than about type, and
    // node says so with a different code.
    if (input.detached) {
      throw new ERR_INVALID_STATE("Cannot validate on a detached ArrayBuffer");
    }
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    if (!(input.buffer instanceof ArrayBuffer)) {
      throw new ERR_INVALID_ARG_TYPE(name, ["ArrayBuffer", "Buffer", "TypedArray"], input);
    }
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new ERR_INVALID_ARG_TYPE(name, ["ArrayBuffer", "Buffer", "TypedArray"], input);
}

/** Whether every byte is below 0x80. Upstream `lib/buffer.js`. */
export function isAscii(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = asBytes(input, "input");
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]! > 0x7f) {
      return false;
    }
  }
  return true;
}

type TranscodeEncoding = "utf8" | "utf16le" | "latin1" | "ascii";
type TranscodeErrorCode =
  | "U_ILLEGAL_ARGUMENT_ERROR"
  | "U_INVALID_CHAR_FOUND";

class TranscodeError extends Error {
  readonly code: TranscodeErrorCode;
  readonly errno: number;

  constructor(code: TranscodeErrorCode) {
    super(`Unable to transcode Buffer [${code}]`);
    this.code = code;
    this.errno = code === "U_ILLEGAL_ARGUMENT_ERROR" ? 1 : 10;
  }
}

function transcodeEncoding(value: string): TranscodeEncoding {
  const normalized = normalizeEncodingName(value);
  switch (normalized) {
    case "utf8": case "utf-8": return "utf8";
    case "ucs2": case "ucs-2": case "utf16le": case "utf-16le": return "utf16le";
    case "latin1": case "binary": return "latin1";
    case "ascii": return "ascii";
    default:
      throw new TranscodeError("U_ILLEGAL_ARGUMENT_ERROR");
  }
}

function transcodeSingleByte(value: string, ascii: boolean): Buffer {
  const maximum = ascii ? 0x7f : 0xff;
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (
      code >= 0xd800 && code <= 0xdbff &&
      i + 1 < value.length
    ) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + next - 0xdc00 + 0x10000;
        i += 1;
      }
    }
    if (code > maximum && isDefaultIgnorableCodePoint(code)) continue;
    count += 1;
  }

  const output = Buffer.allocUnsafe(count);
  let at = 0;
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (
      code >= 0xd800 && code <= 0xdbff &&
      i + 1 < value.length
    ) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + next - 0xdc00 + 0x10000;
        i += 1;
      }
    }
    if (code > maximum && isDefaultIgnorableCodePoint(code)) continue;
    output[at] = code <= maximum ? code : 0x3f;
    at += 1;
  }
  return output;
}

/** Unicode Default_Ignorable_Code_Point, the characters ICU omits on fallback. */
function isDefaultIgnorableCodePoint(code: number): boolean {
  return code === 0x00ad || code === 0x034f || code === 0x061c ||
    (code >= 0x115f && code <= 0x1160) ||
    (code >= 0x17b4 && code <= 0x17b5) ||
    (code >= 0x180b && code <= 0x180f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0x3164 ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff || code === 0xffa0 ||
    (code >= 0xfff0 && code <= 0xfff8) ||
    (code >= 0x1bca0 && code <= 0x1bca3) ||
    (code >= 0x1d173 && code <= 0x1d17a) ||
    (code >= 0xe0000 && code <= 0xe0fff);
}

function decodeAsciiForTranscode(
  source: Uint8Array,
  destination: TranscodeEncoding,
): string {
  let value = "";
  for (let i = 0; i < source.length; i++) {
    const byte = source[i];
    if (byte === undefined) break;
    if (byte < 0x80) {
      value += String.fromCharCode(byte);
    } else if (destination === "utf16le") {
      value += String.fromCharCode(byte);
    } else if (destination === "utf8") {
      value += "\ufffd";
    } else {
      value += "?";
    }
  }
  return value;
}

function decodeUtf16ForTranscode(
  source: Uint8Array,
  destination: TranscodeEncoding,
): string {
  const strict = destination === "utf8";
  const replaceTrailingByte = destination === "utf16le";
  let value = "";
  let index = 0;
  while (index + 1 < source.length) {
    const low = source[index];
    const high = source[index + 1];
    if (low === undefined || high === undefined) break;
    const code = low | (high << 8);
    index += 2;

    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 < source.length) {
        const nextLow = source[index];
        const nextHigh = source[index + 1];
        if (nextLow !== undefined && nextHigh !== undefined) {
          const next = nextLow | (nextHigh << 8);
          if (next >= 0xdc00 && next <= 0xdfff) {
            value += String.fromCharCode(code, next);
            index += 2;
            continue;
          }
        }
      }
      if (strict) throw new TranscodeError("U_INVALID_CHAR_FOUND");
      if (index + 1 === source.length) index = source.length;
      value += "\ufffd";
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      if (strict) throw new TranscodeError("U_INVALID_CHAR_FOUND");
      value += "\ufffd";
      continue;
    }
    value += String.fromCharCode(code);
  }
  if (index < source.length) {
    if (strict && value.length === 0) {
      throw new TranscodeError("U_INVALID_CHAR_FOUND");
    }
    if (replaceTrailingByte) value += "\ufffd";
  }
  return value;
}

/** Convert bytes between Node's ICU single-byte, UTF-8, and UTF-16 codecs. */
export function transcode(
  source: Uint8Array,
  fromEncoding: string,
  toEncoding: string,
): Buffer {
  if (!(source instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE("source", ["Buffer", "Uint8Array"], source);
  }
  if (source.length === 0) return Buffer.alloc(0);
  const from = transcodeEncoding(fromEncoding);
  const to = transcodeEncoding(toEncoding);
  let value: string;
  if (from === "ascii") {
    value = decodeAsciiForTranscode(source, to);
  } else if (from === "utf16le") {
    value = decodeUtf16ForTranscode(source, to);
  } else {
    if (from === "utf8" && to === "utf16le" && !isUtf8(source)) {
      throw new TranscodeError("U_INVALID_CHAR_FOUND");
    }
    value = decodeIn(source, 0, source.length, from);
  }
  if (to === "ascii") return transcodeSingleByte(value, true);
  if (to === "latin1") return transcodeSingleByte(value, false);
  return Buffer.from(value, to);
}

class InvalidCharacterError extends Error {
  override readonly name = "InvalidCharacterError";
  readonly code = 5;

  constructor(message = "Invalid character") {
    super(message);
  }
}

function isBase64Digit(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b || code === 0x2f;
}

function isBase64Whitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0c ||
    code === 0x0d || code === 0x20;
}

/** WHATWG `atob`, restricted to its statically typed string boundary. */
export function atob(data: string): string {
  if (typeof data !== "string") {
    throw new ERR_INVALID_ARG_TYPE("input", "string", data);
  }

  let encodedLength = 0;
  let previous = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (isBase64Whitespace(code)) continue;
    encodedLength += 1;
    previous = last;
    last = code;
  }

  let payloadLength = encodedLength;
  if (payloadLength > 0 && last === 0x3d) {
    payloadLength -= 1;
    if (payloadLength > 0 && previous === 0x3d) {
      payloadLength -= 1;
    }
  }
  let nonWhitespaceIndex = 0;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (isBase64Whitespace(code)) continue;
    if (
      nonWhitespaceIndex < payloadLength
        ? !isBase64Digit(code)
        : code !== 0x3d
    ) {
      throw new InvalidCharacterError();
    }
    nonWhitespaceIndex += 1;
  }
  if (payloadLength % 4 === 1) {
    throw new InvalidCharacterError("The string to be decoded is not correctly encoded.");
  }
  if (payloadLength !== encodedLength && encodedLength % 4 !== 0) {
    throw new InvalidCharacterError();
  }
  return Buffer.from(data, "base64").toString("latin1");
}

/** WHATWG `btoa`, restricted to its statically typed Latin-1 string input. */
export function btoa(data: string): string {
  if (typeof data !== "string") {
    throw new ERR_INVALID_ARG_TYPE("input", "string", data);
  }
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) > 0xff) throw new InvalidCharacterError();
  }
  return Buffer.from(data, "latin1").toString("base64");
}

export default Buffer;
