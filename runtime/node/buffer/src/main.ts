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
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  byteLengthIn,
  decodeIn,
  isEncoding as isEncodingName,
  normalizeEncoding,
  writeIn,
  type Encoding,
} from "./encodings.ts";

export { isEncodingName as isEncoding };

/** Node's cap on a single buffer, and what `alloc` compares against. */
export const kMaxLength = 4294967296 - 1;
export const kStringMaxLength = 536870888;
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: kStringMaxLength };

function checkEncoding(encoding: string | undefined): Encoding {
  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) {
    throw new ERR_INVALID_ARG_TYPE("encoding", "string", encoding);
  }
  return normalized;
}

function checkSize(size: unknown): number {
  if (typeof size !== "number") {
    throw new ERR_INVALID_ARG_TYPE("size", "number", size);
  }
  if (!Number.isInteger(size) || size < 0 || size > kMaxLength) {
    throw new ERR_OUT_OF_RANGE("size", `>= 0 && <= ${kMaxLength}`, size);
  }
  return size;
}

export class Buffer extends Uint8Array {
  // ------------------------------------------------------------- allocation

  /** Zero-filled. Upstream `lib/buffer.js`. */
  static alloc(size: number, fill?: string | number | Buffer, encoding?: string): Buffer {
    const buf = new Buffer(checkSize(size));
    if (fill !== undefined && size > 0) {
      buf.fill(fill as never, 0, size, encoding);
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
   * Upstream `lib/buffer.js`.
   *
   * The mapping overload is `Uint8Array.from`'s rather than node's, and it is
   * kept because a subclass whose static `from` refuses what the base accepts
   * is a subclass in name only. Node's own `Buffer.from` does not implement it;
   * ours does, at the cost of three lines.
   */
  static override from<T>(
    arrayLike: ArrayLike<T> | Iterable<T>,
    mapfn: (v: T, k: number) => number,
    thisArg?: unknown,
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
    if (typeof encodingOrOffset === "function") {
      const mapfn = encodingOrOffset as (v: unknown, k: number) => number;
      const items = Array.from(value as Iterable<unknown>);
      const out = new Buffer(items.length);
      for (let i = 0; i < items.length; i++) {
        out[i] = mapfn.call(length, items[i], i) & 0xff;
      }
      return out;
    }
    if (typeof value === "string") {
      const encoding = checkEncoding(encodingOrOffset as string | undefined);
      const size = byteLengthIn(value, encoding);
      const buf = new Buffer(size);
      writeIn(buf, value, 0, size, encoding);
      return buf;
    }

    if (value instanceof ArrayBuffer) {
      // A view onto the same memory, not a copy: upstream shares the buffer so
      // that a `Buffer` over an `ArrayBuffer` sees later writes to it.
      const offset = typeof encodingOrOffset === "number" ? encodingOrOffset : 0;
      const count = (length as number | undefined) ?? value.byteLength - offset;
      return new Buffer(value, offset, count);
    }

    if (value instanceof Uint8Array) {
      const buf = new Buffer(value.length);
      buf.set(value);
      return buf;
    }

    if (value !== null && typeof value === "object" && "length" in value) {
      const source = value as ArrayLike<number>;
      const buf = new Buffer(source.length);
      for (let i = 0; i < source.length; i++) {
        buf[i] = source[i]! & 0xff;
      }
      return buf;
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

  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
    if (!Array.isArray(list)) {
      throw new ERR_INVALID_ARG_TYPE("list", ["Array", "Buffer", "Uint8Array"], list);
    }
    if (totalLength !== undefined) {
      if (typeof totalLength !== "number") {
        throw new ERR_INVALID_ARG_TYPE("totalLength", "number", totalLength);
      }
      if (!Number.isInteger(totalLength) || totalLength < 0 || totalLength > kMaxLength) {
        throw new ERR_OUT_OF_RANGE("length", `>= 0 && <= ${kMaxLength}`, totalLength);
      }
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

  static isBuffer(value: unknown): value is Buffer {
    return value instanceof Buffer;
  }

  static byteLength(
    value: string | Uint8Array | ArrayBuffer,
    encoding?: string,
  ): number {
    if (typeof value === "string") {
      return byteLengthIn(value, checkEncoding(encoding));
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }
    return value.length;
  }

  static compare(a: Uint8Array, b: Uint8Array): number {
    return compareBytes(a, 0, a.length, b, 0, b.length);
  }

  // ---------------------------------------------------------------- reading

  /** Upstream `lib/buffer.js`. */
  override toString(encoding?: string, start = 0, end = this.length): string {
    const codec = checkEncoding(encoding);
    const from = Math.max(0, Math.min(start, this.length));
    const to = Math.max(from, Math.min(end, this.length));
    return decodeIn(this, from, to, codec);
  }

  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: Array.from(this) };
  }

  /** Upstream `lib/buffer.js`. Bytes in, at `offset`, at most `length`. */
  write(str: string, offset?: number, length?: number, encoding?: string): number {
    let at = 0;
    let max = this.length;
    let codec: string | undefined;

    // `write(str, encoding)`, `write(str, offset, encoding)` and the full form
    // all reach here; node distinguishes them by type rather than by arity.
    if (typeof offset === "string") {
      codec = offset;
    } else if (offset !== undefined) {
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
    targetStart = 0,
    targetEnd = target.length,
    sourceStart = 0,
    sourceEnd = this.length,
  ): number {
    return compareBytes(this, sourceStart, sourceEnd, target, targetStart, targetEnd);
  }

  // ---------------------------------------------------------------- copying

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const from = Math.max(0, Math.min(sourceStart, this.length));
    const to = Math.max(from, Math.min(sourceEnd, this.length));
    const room = target.length - targetStart;
    const n = Math.max(0, Math.min(to - from, room));
    target.set(this.subarray(from, from + n), targetStart);
    return n;
  }

  override subarray(start?: number, end?: number): Buffer {
    // A view, not a copy — which is what `slice` means on a `Buffer` too, and
    // the difference from `Array.prototype.slice` that surprises people.
    const view = super.subarray(start, end);
    return new Buffer(view.buffer, view.byteOffset, view.byteLength);
  }

  override slice(start?: number, end?: number): Buffer {
    return this.subarray(start, end);
  }

  override fill(
    value: string | number | Uint8Array,
    offset = 0,
    end = this.length,
    encoding?: string,
  ): this {
    const from = Math.max(0, Math.min(offset, this.length));
    const to = Math.max(from, Math.min(end, this.length));

    if (typeof value === "number") {
      super.fill(value & 0xff, from, to);
      return this;
    }

    const pattern =
      typeof value === "string"
        ? Buffer.from(value, encoding ?? "utf8")
        : value;
    if (pattern.length === 0) {
      super.fill(0, from, to);
      return this;
    }
    // Repeat the pattern, truncating the last copy: `fill('ab', 0, 5)` gives
    // `ababa`.
    for (let i = from; i < to; i++) {
      this[i] = pattern[(i - from) % pattern.length]!;
    }
    return this;
  }

  // ---------------------------------------------------------------- finding

  override indexOf(value: string | number | Uint8Array, byteOffset = 0, encoding?: string): number {
    return search(this, value, byteOffset, encoding, true);
  }

  override lastIndexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: string): number {
    return search(this, value, byteOffset ?? this.length, encoding, false);
  }

  override includes(value: string | number | Uint8Array, byteOffset = 0, encoding?: string): boolean {
    return this.indexOf(value, byteOffset, encoding) !== -1;
  }

  // ------------------------------------------------------------- byte order

  swap16(): this {
    if (this.length % 2 !== 0) {
      throw new ERR_OUT_OF_RANGE("buffer.length", "a multiple of 2", this.length);
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
      throw new ERR_OUT_OF_RANGE("buffer.length", "a multiple of 4", this.length);
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
      throw new ERR_OUT_OF_RANGE("buffer.length", "a multiple of 8", this.length);
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

  private at8(offset: number, size: number): number {
    if (offset < 0 || offset + size > this.length) {
      throw new ERR_OUT_OF_RANGE("offset", `>= 0 && <= ${this.length - size}`, offset);
    }
    return offset;
  }

  readUInt8(offset = 0): number {
    return this[this.at8(offset, 1)]!;
  }

  readInt8(offset = 0): number {
    const v = this[this.at8(offset, 1)]!;
    return v & 0x80 ? v - 0x100 : v;
  }

  readUInt16LE(offset = 0): number {
    const at = this.at8(offset, 2);
    return this[at]! | (this[at + 1]! << 8);
  }

  readUInt16BE(offset = 0): number {
    const at = this.at8(offset, 2);
    return (this[at]! << 8) | this[at + 1]!;
  }

  readInt16LE(offset = 0): number {
    const v = this.readUInt16LE(offset);
    return v & 0x8000 ? v - 0x10000 : v;
  }

  readInt16BE(offset = 0): number {
    const v = this.readUInt16BE(offset);
    return v & 0x8000 ? v - 0x10000 : v;
  }

  readUInt32LE(offset = 0): number {
    const at = this.at8(offset, 4);
    // `>>> 0` because the shift makes it signed and this value is not.
    return ((this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16)) + this[at + 3]! * 0x1000000) >>> 0;
  }

  readUInt32BE(offset = 0): number {
    const at = this.at8(offset, 4);
    return (this[at]! * 0x1000000 + ((this[at + 1]! << 16) | (this[at + 2]! << 8) | this[at + 3]!)) >>> 0;
  }

  readInt32LE(offset = 0): number {
    const at = this.at8(offset, 4);
    return this[at]! | (this[at + 1]! << 8) | (this[at + 2]! << 16) | (this[at + 3]! << 24);
  }

  readInt32BE(offset = 0): number {
    const at = this.at8(offset, 4);
    return (this[at]! << 24) | (this[at + 1]! << 16) | (this[at + 2]! << 8) | this[at + 3]!;
  }

  writeUInt8(value: number, offset = 0): number {
    const at = this.at8(offset, 1);
    this[at] = value & 0xff;
    return at + 1;
  }

  writeInt8(value: number, offset = 0): number {
    return this.writeUInt8(value, offset);
  }

  writeUInt16LE(value: number, offset = 0): number {
    const at = this.at8(offset, 2);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    return at + 2;
  }

  writeUInt16BE(value: number, offset = 0): number {
    const at = this.at8(offset, 2);
    this[at] = (value >>> 8) & 0xff;
    this[at + 1] = value & 0xff;
    return at + 2;
  }

  writeInt16LE(value: number, offset = 0): number {
    return this.writeUInt16LE(value, offset);
  }

  writeInt16BE(value: number, offset = 0): number {
    return this.writeUInt16BE(value, offset);
  }

  writeUInt32LE(value: number, offset = 0): number {
    const at = this.at8(offset, 4);
    this[at] = value & 0xff;
    this[at + 1] = (value >>> 8) & 0xff;
    this[at + 2] = (value >>> 16) & 0xff;
    this[at + 3] = (value >>> 24) & 0xff;
    return at + 4;
  }

  writeUInt32BE(value: number, offset = 0): number {
    const at = this.at8(offset, 4);
    this[at] = (value >>> 24) & 0xff;
    this[at + 1] = (value >>> 16) & 0xff;
    this[at + 2] = (value >>> 8) & 0xff;
    this[at + 3] = value & 0xff;
    return at + 4;
  }

  writeInt32LE(value: number, offset = 0): number {
    return this.writeUInt32LE(value, offset);
  }

  writeInt32BE(value: number, offset = 0): number {
    return this.writeUInt32BE(value, offset);
  }

  // Floats go through a one-element typed array, because reproducing IEEE-754
  // rounding by hand is a way to be subtly wrong.
  readFloatLE(offset = 0): number {
    scratchBytes.set(this.subarray(this.at8(offset, 4), offset + 4));
    return scratchFloat[0]!;
  }

  readFloatBE(offset = 0): number {
    const at = this.at8(offset, 4);
    for (let i = 0; i < 4; i++) scratchBytes[i] = this[at + 3 - i]!;
    return scratchFloat[0]!;
  }

  writeFloatLE(value: number, offset = 0): number {
    const at = this.at8(offset, 4);
    scratchFloat[0] = value;
    for (let i = 0; i < 4; i++) this[at + i] = scratchBytes[i]!;
    return at + 4;
  }

  writeFloatBE(value: number, offset = 0): number {
    const at = this.at8(offset, 4);
    scratchFloat[0] = value;
    for (let i = 0; i < 4; i++) this[at + i] = scratchBytes[3 - i]!;
    return at + 4;
  }

  readDoubleLE(offset = 0): number {
    const at = this.at8(offset, 8);
    for (let i = 0; i < 8; i++) scratchBytes8[i] = this[at + i]!;
    return scratchDouble[0]!;
  }

  readDoubleBE(offset = 0): number {
    const at = this.at8(offset, 8);
    for (let i = 0; i < 8; i++) scratchBytes8[i] = this[at + 7 - i]!;
    return scratchDouble[0]!;
  }

  writeDoubleLE(value: number, offset = 0): number {
    const at = this.at8(offset, 8);
    scratchDouble[0] = value;
    for (let i = 0; i < 8; i++) this[at + i] = scratchBytes8[i]!;
    return at + 8;
  }

  writeDoubleBE(value: number, offset = 0): number {
    const at = this.at8(offset, 8);
    scratchDouble[0] = value;
    for (let i = 0; i < 8; i++) this[at + i] = scratchBytes8[7 - i]!;
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
  byteOffset: number,
  encoding: string | undefined,
  forward: boolean,
): number {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !ArrayBuffer.isView(value)
  ) {
    throw new ERR_INVALID_ARG_TYPE("value", ["number", "string", "Buffer", "Uint8Array"], value);
  }
  if (typeof value === "number") {
    const needle = value & 0xff;
    if (forward) {
      for (let i = Math.max(0, byteOffset); i < haystack.length; i++) {
        if (haystack[i] === needle) return i;
      }
    } else {
      for (let i = Math.min(byteOffset, haystack.length - 1); i >= 0; i--) {
        if (haystack[i] === needle) return i;
      }
    }
    return -1;
  }

  const needle =
    typeof value === "string" ? Buffer.from(value, encoding ?? "utf8") : value;
  if (needle.length === 0) {
    return forward ? Math.min(Math.max(0, byteOffset), haystack.length) : haystack.length;
  }
  if (needle.length > haystack.length) {
    return -1;
  }

  const last = haystack.length - needle.length;
  const from = forward ? Math.max(0, byteOffset) : Math.min(byteOffset, last);
  const step = forward ? 1 : -1;
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

/**
 * `SlowBuffer`, upstream `lib/buffer.js`. Deprecated since v4 and still
 * exported, so still part of the surface.
 *
 * A plain function rather than a class: node's is callable without `new`, and
 * every use of it in the wild predates `class`.
 */
export function SlowBuffer(length: number): Buffer {
  return Buffer.allocUnsafeSlow(length);
}

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
  if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
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

/** `atob`/`btoa`, which node exposes from this module. */
export function atob(data: string): string {
  return Buffer.from(data, "base64").toString("latin1");
}

export function btoa(data: string): string {
  return Buffer.from(data, "latin1").toString("base64");
}

export default Buffer;
