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
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_THIS,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";

/**
 * Read one view as bytes.
 *
 * `Buffer` can share an `ArrayBuffer` directly. Its statically typed backing
 * store does not include `SharedArrayBuffer`, so that uncommon input is copied
 * once instead of being hidden behind a cast. The decoder consumes it
 * immediately, so sharing is not observable during the call.
 */
function bytesOf(view: ArrayBufferView): Buffer {
  if (view.buffer instanceof ArrayBuffer) {
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  return Buffer.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/**
 * How many bytes the UTF-8 character starting with `byte` occupies.
 *
 * `-1` for a continuation byte, which is not a start; `-2` for a byte that
 * cannot appear in UTF-8 at all. The two are distinguished because a scan
 * backwards can step over the first and must stop at the second.
 */
function utf8CheckByte(byte: number): number {
  if (byte <= 0x7f) return 0;
  // This is deliberately a structural lead-byte check, not complete UTF-8
  // validation. Node buffers C0/C1 and F5..F7 at a chunk boundary and lets the
  // decoder report their replacement characters once the nominal sequence is
  // complete. Rejecting them here changes when output becomes observable.
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
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
  readonly encoding: Encoding;

  /** The bytes of a character seen so far. Four is the longest any encoding needs. */
  readonly #lastChar: Buffer;
  /** How many more bytes that character needs. */
  #lastNeed = 0;
  /** How many bytes it will have in total. */
  #lastTotal = 0;

  readonly #codec: Encoding;
  /** Bytes consumed while completing the previous chunk's tail. */
  #fillConsumed = 0;

  get lastChar(): Buffer {
    return this.#lastChar;
  }

  get lastNeed(): number {
    return this.#lastNeed;
  }

  get lastTotal(): number {
    return this.#lastTotal;
  }

  constructor(encoding?: Encoding) {
    // The public form is `BufferEncoding`, while the shared normalizer also
    // validates values arriving from untyped JavaScript callers.
    const normalized = normalizeEncoding(encoding);
    if (normalized === undefined) {
      throw new ERR_UNKNOWN_ENCODING(encoding);
    }
    this.#codec = normalized;
    // Node reports the normalized name: `new StringDecoder('UTF-8').encoding`
    // is `'utf8'`.
    this.encoding = normalized;
    this.#lastChar = Buffer.allocUnsafe(4);
  }

  write(buf: ArrayBufferView | string): string {
    if (typeof buf === "string") {
      return buf;
    }
    if (!ArrayBuffer.isView(buf)) {
      throw new ERR_INVALID_ARG_TYPE("buf", ["Buffer", "TypedArray", "DataView"], buf);
    }
    if (!(this instanceof StringDecoder)) {
      throw new ERR_INVALID_THIS("StringDecoder");
    }
    // A view over the same memory, not a copy: the decoder only reads, and
    // copying every chunk would defeat the point of streaming.
    const bytes = bytesOf(buf);
    if (bytes.length === 0) {
      return "";
    }

    let head: string | undefined;
    let at = 0;
    if (this.#lastNeed > 0) {
      head = this.fillLast(bytes);
      if (head === undefined) {
        return "";
      }
      at = this.#fillConsumed;
    }

    if (at < bytes.length) {
      const rest = this.text(bytes, at);
      return head === undefined ? rest : head + rest;
    }
    return head ?? "";
  }

  /** Whatever is left, including an incomplete character. */
  end(buf?: ArrayBufferView | string): string {
    if (!(this instanceof StringDecoder)) {
      throw new ERR_INVALID_THIS("StringDecoder");
    }
    const head = buf === undefined ? "" : this.write(buf);
    if (this.#lastNeed > 0) {
      const tail = this.flush();
      // "After end() is called, the stringDecoder object can be reused for new
      // input" -- so the pending character has to go, not just be reported.
      // Leaving it made the *next* `write` finish a character from the
      // previous stream.
      this.#lastNeed = 0;
      this.#lastTotal = 0;
      return head + tail;
    }
    return head;
  }

  /**
   * Undocumented, still public. Node's own tests call it, and its contract is
   * that the pending state is discarded first.
   */
  text(buf: ArrayBufferView, offset: number): string {
    if (!(this instanceof StringDecoder)) {
      throw new ERR_INVALID_THIS("StringDecoder");
    }
    this.#lastNeed = 0;
    this.#lastTotal = 0;
    this.#fillConsumed = 0;
    const bytes = bytesOf(buf);
    switch (this.#codec) {
      case "utf8":
      case "utf-8":
        return this.utf8Text(bytes, offset);
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return this.utf16Text(bytes, offset);
      case "base64":
      case "base64url":
        return this.base64Text(bytes, offset);
      default:
        // latin1, ascii and hex map byte-for-byte, so no character can straddle
        // a chunk boundary and there is nothing to hold back.
        return bytes.toString(this.#codec, offset, bytes.length);
    }
  }

  /** Complete the pending character from the head of `bytes`, if it can be. */
  private fillLast(bytes: Buffer): string | undefined {
    const have = this.#lastTotal - this.#lastNeed;
    const needed = this.#lastNeed;
    this.#fillConsumed = 0;

    if (this.#codec === "utf8" || this.#codec === "utf-8") {
      // Copy only the continuation prefix. If an unexpected byte begins a new
      // character, decode the incomplete sequence as-is and leave that byte
      // for the ordinary body decoder. This is `DecodeData`'s first loop in
      // `src/string_decoder.cc`.
      const inspect = Math.min(bytes.length, needed);
      for (let i = 0; i < inspect; i++) {
        const byte = bytes[i];
        if (byte === undefined) break;
        if ((byte & 0xc0) !== 0x80) {
          for (let copied = 0; copied < i; copied++) {
            const continuation = bytes[copied];
            if (continuation === undefined) break;
            this.#lastChar[have + copied] = continuation;
          }
          this.#lastNeed = 0;
          this.#lastTotal = 0;
          this.#fillConsumed = i;
          return this.#lastChar.toString("utf8", 0, have + i);
        }
      }
    }

    const found = Math.min(bytes.length, needed);
    for (let i = 0; i < found; i++) {
      const byte = bytes[i];
      if (byte === undefined) break;
      this.#lastChar[have + i] = byte;
    }
    this.#lastNeed -= found;
    this.#fillConsumed = found;
    if (this.#lastNeed === 0) {
      const total = this.#lastTotal;
      this.#lastTotal = 0;
      return this.#lastChar.toString(this.#codec, 0, total);
    }
    return undefined;
  }

  /** What the buffered bytes decode to when the stream ends on them. */
  private flush(): string {
    switch (this.#codec) {
      case "base64":
      case "base64url":
        return this.#lastChar.toString(this.#codec, 0, 3 - this.#lastNeed);
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return this.#lastChar.toString("utf16le", 0, this.#lastTotal - this.#lastNeed);
      case "utf8":
      case "utf-8":
        // Decode the bytes themselves. A valid truncated sequence becomes one
        // replacement, while an invalid prefix such as F0 8F A2 becomes three;
        // returning a fixed replacement loses that distinction.
        return this.#lastChar.toString("utf8", 0, this.#lastTotal - this.#lastNeed);
      default:
        return "";
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

    const last = buf[j];
    if (last === undefined) return 0;
    let nb = utf8CheckByte(last);
    if (nb >= 0) {
      if (nb > 0) this.#lastNeed = nb - 1;
      return nb;
    }
    if (--j < i || nb === -2) return 0;

    const secondLast = buf[j];
    if (secondLast === undefined) return 0;
    nb = utf8CheckByte(secondLast);
    if (nb >= 0) {
      if (nb > 0) this.#lastNeed = nb - 2;
      return nb;
    }
    if (--j < i || nb === -2) return 0;

    const thirdLast = buf[j];
    if (thirdLast === undefined) return 0;
    nb = utf8CheckByte(thirdLast);
    if (nb >= 0) {
      if (nb > 0) {
        // A two-byte character three back is already complete.
        if (nb === 2) nb = 0;
        else this.#lastNeed = nb - 3;
      }
      return nb;
    }
    return 0;
  }

  /** Decode the complete prefix and retain an incomplete trailing sequence. */
  private utf8Text(buf: Buffer, i: number): string {
    const total = this.checkIncomplete(buf, i);
    if (this.#lastNeed === 0) {
      return buf.toString("utf8", i, buf.length);
    }
    this.#lastTotal = total;
    const end = buf.length - (total - this.#lastNeed);
    for (let k = 0; k < buf.length - end; k++) {
      const byte = buf[end + k];
      if (byte === undefined) break;
      this.#lastChar[k] = byte;
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
          const low = buf[buf.length - 2];
          const high = buf[buf.length - 1];
          if (low === undefined || high === undefined) return r;
          this.#lastNeed = 2;
          this.#lastTotal = 4;
          this.#lastChar[0] = low;
          this.#lastChar[1] = high;
          return r.slice(0, -1);
        }
      }
      return r;
    }
    // An odd byte is half a code unit.
    this.#lastNeed = 1;
    this.#lastTotal = 2;
    const last = buf[buf.length - 1];
    if (last === undefined) return "";
    this.#lastChar[0] = last;
    return buf.toString("utf16le", i, buf.length - 1);
  }

  // -------------------------------------------------------------- base64

  private base64Text(buf: Buffer, i: number): string {
    const n = (buf.length - i) % 3;
    if (n === 0) {
      return buf.toString(this.#codec, i, buf.length);
    }
    // Three bytes make four characters with no padding. A remainder would be
    // padded, and padding in the middle of a stream is wrong.
    this.#lastNeed = 3 - n;
    this.#lastTotal = 3;
    if (n === 1) {
      const last = buf[buf.length - 1];
      if (last === undefined) return "";
      this.#lastChar[0] = last;
    } else {
      const first = buf[buf.length - 2];
      const second = buf[buf.length - 1];
      if (first === undefined || second === undefined) return "";
      this.#lastChar[0] = first;
      this.#lastChar[1] = second;
    }
    return buf.toString(this.#codec, i, buf.length - n);
  }
}

export default { StringDecoder };
