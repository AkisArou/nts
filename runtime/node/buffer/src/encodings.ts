// The encodings `Buffer` knows, node `lib/buffer.js` and `src/string_bytes.cc`.
//
// Each is a pair: bytes to string, and string to bytes. They are separate from
// the `Buffer` class because `StringDecoder` needs them too, and because a
// table of small independent codecs is easier to be sure of than a switch
// inside a method.

import { utf8Decode, utf8Length, utf8Write } from "../../internal/utf8.ts";

export type Encoding =
  | "utf8" | "utf-8"
  | "hex"
  | "base64" | "base64url"
  | "latin1" | "binary"
  | "ascii"
  | "ucs2" | "ucs-2" | "utf16le" | "utf-16le";

/** Node accepts several spellings for one encoding. */
export function normalizeEncoding(encoding: string | undefined | null): Encoding | undefined {
  if (encoding === undefined || encoding === null) {
    return "utf8";
  }
  switch (encoding.toLowerCase()) {
    case "utf8": case "utf-8": return "utf8";
    case "hex": return "hex";
    case "base64": return "base64";
    case "base64url": return "base64url";
    case "latin1": case "binary": return "latin1";
    case "ascii": return "ascii";
    case "ucs2": case "ucs-2": case "utf16le": case "utf-16le": return "utf16le";
    default: return undefined;
  }
}

export function isEncoding(encoding: string): boolean {
  return normalizeEncoding(encoding) !== undefined;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Value of each base64 digit, indexed by code unit; -1 elsewhere. */
const BASE64_VALUES: number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (let i = 0; i < BASE64.length; i++) {
    table[BASE64.charCodeAt(i)] = i;
  }
  // The URL alphabet differs in two places, and node decodes both alphabets
  // with one table: `-` and `_` are unambiguous.
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

const HEX_VALUES: number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (let i = 0; i <= 9; i++) table[48 + i] = i;
  for (let i = 0; i < 6; i++) {
    table[65 + i] = 10 + i;
    table[97 + i] = 10 + i;
  }
  return table;
})();

/** How many bytes `str` occupies in `encoding`. */
export function byteLengthIn(str: string, encoding: Encoding): number {
  switch (encoding) {
    case "utf8": case "utf-8":
      return utf8Length(str);
    case "ascii": case "latin1": case "binary":
      return str.length;
    case "ucs2": case "ucs-2": case "utf16le": case "utf-16le":
      return str.length * 2;
    case "hex":
      return str.length >>> 1;
    case "base64": case "base64url": {
      // Padding and any character outside the alphabet contribute nothing.
      let n = 0;
      for (let i = 0; i < str.length; i++) {
        if (BASE64_VALUES[str.charCodeAt(i)]! >= 0) n++;
      }
      return (n * 3) >>> 2;
    }
  }
}

/** Write `str` into `out` at `offset`, at most `max` bytes. */
export function writeIn(
  out: Uint8Array,
  str: string,
  offset: number,
  max: number,
  encoding: Encoding,
): number {
  switch (encoding) {
    case "utf8": case "utf-8":
      return utf8Write(out, str, offset, max);

    case "ascii": {
      // Node masks to seven bits rather than refusing: `ascii` is lossy by
      // definition and the mask is what its C++ does.
      const n = Math.min(str.length, max);
      for (let i = 0; i < n; i++) out[offset + i] = str.charCodeAt(i) & 0x7f;
      return n;
    }

    case "latin1": case "binary": {
      const n = Math.min(str.length, max);
      for (let i = 0; i < n; i++) out[offset + i] = str.charCodeAt(i) & 0xff;
      return n;
    }

    case "ucs2": case "ucs-2": case "utf16le": case "utf-16le": {
      // Whole code units only; half of one is not a character.
      const n = Math.min(str.length * 2, max - (max % 2));
      for (let i = 0; i < n / 2; i++) {
        const c = str.charCodeAt(i);
        out[offset + i * 2] = c & 0xff;
        out[offset + i * 2 + 1] = c >> 8;
      }
      return n;
    }

    case "hex": {
      let written = 0;
      for (let i = 0; i + 1 < str.length + 1 && written < max; i += 2) {
        const hi = HEX_VALUES[str.charCodeAt(i)]!;
        const lo = HEX_VALUES[str.charCodeAt(i + 1)]!;
        // A non-hex character ends the write; node stops rather than skipping.
        if (hi < 0 || lo < 0) break;
        out[offset + written] = (hi << 4) | lo;
        written++;
      }
      return written;
    }

    case "base64": case "base64url": {
      let written = 0;
      let acc = 0;
      let bits = 0;
      for (let i = 0; i < str.length; i++) {
        const value = BASE64_VALUES[str.charCodeAt(i)]!;
        if (value < 0) continue;
        acc = (acc << 6) | value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          if (written >= max) break;
          out[offset + written] = (acc >> bits) & 0xff;
          written++;
        }
      }
      return written;
    }
  }
}

/** Read `bytes[start, end)` as `encoding`. */
export function decodeIn(
  bytes: Uint8Array,
  start: number,
  end: number,
  encoding: Encoding,
): string {
  switch (encoding) {
    case "utf8": case "utf-8":
      return utf8Decode(bytes, start, end);

    case "ascii": {
      let out = "";
      for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]! & 0x7f);
      return out;
    }

    case "latin1": case "binary": {
      let out = "";
      for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
      return out;
    }

    case "ucs2": case "ucs-2": case "utf16le": case "utf-16le": {
      let out = "";
      // A trailing odd byte is not half a character; node drops it.
      for (let i = start; i + 1 < end; i += 2) {
        out += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
      }
      return out;
    }

    case "hex": {
      let out = "";
      for (let i = start; i < end; i++) {
        out += bytes[i]!.toString(16).padStart(2, "0");
      }
      return out;
    }

    case "base64": case "base64url": {
      const alphabet = encoding === "base64url" ? BASE64URL : BASE64;
      let out = "";
      let i = start;
      for (; i + 2 < end; i += 3) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
        out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! +
               alphabet[(n >> 6) & 63]! + alphabet[n & 63]!;
      }
      const left = end - i;
      if (left === 1) {
        const n = bytes[i]! << 16;
        out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
        // base64url omits padding; base64 keeps it.
        if (encoding === "base64") out += "==";
      } else if (left === 2) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
        out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]!;
        if (encoding === "base64") out += "=";
      }
      return out;
    }
  }
}
