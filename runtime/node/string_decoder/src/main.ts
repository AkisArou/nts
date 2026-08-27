// `node:string_decoder`, from node v24.20.0 `lib/string_decoder.js`.
//
// # Where the work is
//
// Node's JavaScript here is a shell over `internalBinding('string_decoder')`:
// the state machine that carries an incomplete character across `write` calls
// lives in C++, because it runs once per chunk of every stream. What it
// implements is what this file implements.
//
// The state is three values, and node exposes all three as `lastChar`,
// `lastNeed` and `lastTotal` — undocumented, still public, and still asserted
// on by node's own tests, so they are part of the surface.

import { Buffer } from "../../buffer/src/main.ts";
import { normalizeEncoding, type Encoding } from "../../buffer/src/encodings.ts";
import { ERR_INVALID_ARG_TYPE, ERR_UNKNOWN_ENCODING } from "../../internal/errors.ts";

/**
 * How many bytes the UTF-8 character starting with `byte` occupies.
 *
 * `-1` for a continuation byte, which is not a start; `-2` for a byte that
 * cannot appear in UTF-8 at all. The two are distinguished because a scan
 * backwards can step over the first and must stop at the second.
 */
function utf8CheckByte(byte: number): number {
  if (byte <= 0x7f) return 0;
  // C2..DF, not C0..DF: `C0` and `C1` can only begin an overlong encoding of
  // an ASCII character, so they are not leads at all.
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  // F0..F4, not F0..F7: the last code point is U+10FFFF, and `F5` upwards
  // could only introduce something past it.
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return byte >> 6 === 0x02 ? -1 : -2;
}

/**
 * Splits a series of buffers into strings without breaking a character in two.
 *
 * A chunk boundary can fall anywhere, including inside a three-byte UTF-8
 * character or between the halves of a surrogate pair. Decoding each chunk
 * alone would turn those into replacement characters; this holds the
 * incomplete tail until the next chunk completes it.
 */
export class StringDecoder {
  readonly encoding: string;

  /** The bytes of a character seen so far. Four is the longest any encoding needs. */
  lastChar: Buffer;
  /** How many more bytes that character needs. */
  lastNeed = 0;
  /** How many bytes it will have in total. */
  lastTotal = 0;

  private readonly codec: Encoding;

  constructor(encoding?: string) {
    const normalized = normalizeEncoding(encoding);
    if (normalized === undefined) {
      throw new ERR_UNKNOWN_ENCODING(String(encoding));
    }
    this.codec = normalized;
    // Node reports the normalized name: `new StringDecoder('UTF-8').encoding`
    // is `'utf8'`.
    this.encoding = normalized;
    this.lastChar = Buffer.allocUnsafe(4);
  }

  write(buf: Uint8Array | string): string {
    if (typeof buf === "string") {
      return buf;
    }
    if (!ArrayBuffer.isView(buf)) {
      throw new ERR_INVALID_ARG_TYPE("buf", ["Buffer", "TypedArray", "DataView"], buf);
    }
    // A view over the same memory, not a copy: the decoder only reads, and
    // copying every chunk would defeat the point of streaming.
    const bytes = Buffer.from(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
    if (bytes.length === 0) {
      return "";
    }

    let head: string | undefined;
    let at = 0;
    if (this.lastNeed > 0) {
      head = this.fillLast(bytes);
      if (head === undefined) {
        return "";
      }
      at = this.lastNeed;
      this.lastNeed = 0;
    }

    if (at < bytes.length) {
      const rest = this.text(bytes, at);
      return head === undefined ? rest : head + rest;
    }
    return head ?? "";
  }

  /** Whatever is left, including an incomplete character. */
  end(buf?: Uint8Array | string): string {
    const head = buf !== undefined && (typeof buf === "string" || buf.byteLength > 0)
      ? this.write(buf)
      : "";
    if (this.lastNeed > 0) {
      const tail = this.flush();
      // "After end() is called, the stringDecoder object can be reused for new
      // input" -- so the pending character has to go, not just be reported.
      // Leaving it made the *next* `write` finish a character from the
      // previous stream.
      this.lastNeed = 0;
      this.lastTotal = 0;
      return head + tail;
    }
    return head;
  }

  /**
   * Undocumented, still public. Node's own tests call it, and its contract is
   * that the pending state is discarded first.
   */
  text(buf: Uint8Array, offset: number): string {
    const bytes = Buffer.from(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
    switch (this.codec) {
      case "utf8": case "utf-8":
        return this.utf8Text(bytes, offset);
      case "ucs2": case "ucs-2": case "utf16le": case "utf-16le":
        return this.utf16Text(bytes, offset);
      case "base64": case "base64url":
        return this.base64Text(bytes, offset);
      default:
        // latin1, ascii and hex map byte-for-byte, so no character can straddle
        // a chunk boundary and there is nothing to hold back.
        return bytes.toString(this.codec, offset, bytes.length);
    }
  }

  /** Complete the pending character from the head of `bytes`, if it can be. */
  private fillLast(bytes: Buffer): string | undefined {
    const have = this.lastTotal - this.lastNeed;

    if (this.codec === "utf8" || this.codec === "utf-8") {
      // A held sequence is only valid if what follows are continuation bytes.
      // Finding out here rather than at the end is what makes a run of invalid
      // lead bytes produce one replacement each, as node does.
      const bad = this.checkExtraBytes(bytes);
      if (bad !== undefined) {
        return bad;
      }
    }

    if (this.lastNeed <= bytes.length) {
      for (let i = 0; i < this.lastNeed; i++) {
        this.lastChar[have + i] = bytes[i]!;
      }
      return this.lastChar.toString(this.codec, 0, this.lastTotal);
    }
    for (let i = 0; i < bytes.length; i++) {
      this.lastChar[have + i] = bytes[i]!;
    }
    this.lastNeed -= bytes.length;
    return undefined;
  }

  /**
   * The range the *next* byte of the pending sequence may take.
   *
   * Only the byte straight after the lead is restricted, and only for four of
   * the leads: `E0` forbids `80..9F` because those would be an overlong
   * three-byte encoding, `ED` forbids `A0..BF` because those are surrogates,
   * `F0` forbids `80..8F` as overlong, and `F4` forbids `90..BF` as past
   * U+10FFFF. Every later byte is `80..BF`.
   */
  private continuationRange(): [number, number] {
    if (this.lastTotal - this.lastNeed !== 1) {
      return [0x80, 0xbf];
    }
    switch (this.lastChar[0]!) {
      case 0xe0: return [0xa0, 0xbf];
      case 0xed: return [0x80, 0x9f];
      case 0xf0: return [0x90, 0xbf];
      case 0xf4: return [0x80, 0x8f];
      default: return [0x80, 0xbf];
    }
  }

  /** `'�'` as soon as a byte that should continue the sequence does not. */
  private checkExtraBytes(bytes: Buffer): string | undefined {
    const [lower, upper] = this.continuationRange();
    if (bytes[0]! < lower || bytes[0]! > upper) {
      this.lastNeed = 0;
      return "�";
    }
    if (this.lastNeed > 1 && bytes.length > 1) {
      if ((bytes[1]! & 0xc0) !== 0x80) {
        this.lastNeed = 1;
        return "�";
      }
      if (this.lastNeed > 2 && bytes.length > 2) {
        if ((bytes[2]! & 0xc0) !== 0x80) {
          this.lastNeed = 2;
          return "�";
        }
      }
    }
    return undefined;
  }

  /** What the buffered bytes decode to when the stream ends on them. */
  private flush(): string {
    switch (this.codec) {
      case "base64": case "base64url":
        return this.lastChar.toString(this.codec, 0, 3 - this.lastNeed);
      case "ucs2": case "ucs-2": case "utf16le": case "utf-16le":
        return this.lastChar.toString("utf16le", 0, this.lastTotal - this.lastNeed);
      default:
        // One replacement for the whole truncated sequence, not one per byte.
        return "�";
    }
  }

  // --------------------------------------------------------------- utf8

  /**
   * How many bytes the character at the end of `buf` needs, looking back at
   * most three: a UTF-8 character is at most four bytes, so a start byte is
   * never further than three behind the end.
   */
  private checkIncomplete(buf: Buffer, i: number): number {
    let j = buf.length - 1;
    if (j < i) return 0;

    let nb = utf8CheckByte(buf[j]!);
    if (nb >= 0) {
      if (nb > 0) this.lastNeed = nb - 1;
      return nb;
    }
    if (--j < i || nb === -2) return 0;

    nb = utf8CheckByte(buf[j]!);
    if (nb >= 0) {
      if (nb > 0) this.lastNeed = nb - 2;
      return nb;
    }
    if (--j < i || nb === -2) return 0;

    nb = utf8CheckByte(buf[j]!);
    if (nb >= 0) {
      if (nb > 0) {
        // A two-byte character three back is already complete.
        if (nb === 2) nb = 0;
        else this.lastNeed = nb - 3;
      }
      return nb;
    }
    return 0;
  }

  /**
   * Whether the trailing bytes from `at` are a valid start of a sequence.
   *
   * Buffering an invalid one would defer an error that has already happened,
   * and the deferral changes the answer: `F0 85` is two errors, and holding it
   * as a partial four-byte character makes it one.
   */
  private validPartial(buf: Buffer, at: number): boolean {
    const lead = buf[at]!;
    for (let k = at + 1; k < buf.length; k++) {
      let lower = 0x80;
      let upper = 0xbf;
      if (k === at + 1) {
        if (lead === 0xe0) lower = 0xa0;
        else if (lead === 0xed) upper = 0x9f;
        else if (lead === 0xf0) lower = 0x90;
        else if (lead === 0xf4) upper = 0x8f;
      }
      if (buf[k]! < lower || buf[k]! > upper) {
        return false;
      }
    }
    return true;
  }

  private utf8Text(buf: Buffer, i: number): string {
    const total = this.checkIncomplete(buf, i);
    if (this.lastNeed === 0) {
      return buf.toString("utf8", i, buf.length);
    }
    // The scan back found a lead that wants more bytes. If what follows it is
    // already wrong, there is nothing to wait for.
    if (!this.validPartial(buf, buf.length - (total - this.lastNeed))) {
      this.lastNeed = 0;
      this.lastTotal = 0;
      return buf.toString("utf8", i, buf.length);
    }
    this.lastTotal = total;
    const end = buf.length - (total - this.lastNeed);
    for (let k = 0; k < buf.length - end; k++) {
      this.lastChar[k] = buf[end + k]!;
    }
    return buf.toString("utf8", i, end);
  }

  // ------------------------------------------------------------- utf16le

  private utf16Text(buf: Buffer, i: number): string {
    if ((buf.length - i) % 2 === 0) {
      const r = buf.toString("utf16le", i, buf.length);
      if (r.length > 0) {
        const last = r.charCodeAt(r.length - 1);
        // A high surrogate at the end has its partner in the next chunk.
        if (last >= 0xd800 && last <= 0xdbff) {
          this.lastNeed = 2;
          this.lastTotal = 4;
          this.lastChar[0] = buf[buf.length - 2]!;
          this.lastChar[1] = buf[buf.length - 1]!;
          return r.slice(0, -1);
        }
      }
      return r;
    }
    // An odd byte is half a code unit.
    this.lastNeed = 1;
    this.lastTotal = 2;
    this.lastChar[0] = buf[buf.length - 1]!;
    return buf.toString("utf16le", i, buf.length - 1);
  }

  // -------------------------------------------------------------- base64

  private base64Text(buf: Buffer, i: number): string {
    const n = (buf.length - i) % 3;
    if (n === 0) {
      return buf.toString(this.codec, i, buf.length);
    }
    // Three bytes make four characters with no padding. A remainder would be
    // padded, and padding in the middle of a stream is wrong.
    this.lastNeed = 3 - n;
    this.lastTotal = 3;
    if (n === 1) {
      this.lastChar[0] = buf[buf.length - 1]!;
    } else {
      this.lastChar[0] = buf[buf.length - 2]!;
      this.lastChar[1] = buf[buf.length - 1]!;
    }
    return buf.toString(this.codec, i, buf.length - n);
  }
}

export default { StringDecoder };
