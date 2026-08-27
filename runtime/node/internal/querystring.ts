// Percent-encoding, node `lib/internal/querystring.js`.
//
// Shared between `node:querystring` and `node:url`, which is why it is here
// rather than inside either.

import { ERR_INVALID_URI } from "./errors.ts";

/** `%00` … `%FF`, built once. */
export const hexTable: string[] = (() => {
  const table = new Array<string>(256);
  for (let i = 0; i < 256; ++i) {
    table[i] = `%${((i < 16 ? "0" : "") + i.toString(16)).toUpperCase()}`;
  }
  return table;
})();

/** 1 where the code unit is a hexadecimal digit. */
// prettier-ignore
export const isHexTable: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 64 - 79
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 80 - 95
  0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 96 - 111
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 112 - 127
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/**
 * Percent-encode everything `noEscapeTable` does not exempt, node
 * `lib/internal/querystring.js:53`.
 *
 * The encoding is of UTF-8 bytes, so a code point outside the basic plane is
 * read from its surrogate pair and emitted as four escapes. A lone surrogate
 * has no UTF-8 encoding at all, and is an error rather than a replacement
 * character — silently substituting one would round-trip to different text.
 */
export function encodeStr(
  str: string,
  noEscapeTable: number[],
  hex: string[],
): string {
  const len = str.length;
  if (len === 0) {
    return "";
  }
  let out = "";
  let lastPos = 0;
  let i = 0;

  outer: for (; i < len; i++) {
    let c = str.charCodeAt(i);

    // ASCII, the common case, taken as a run so the slice is one operation.
    while (c < 0x80) {
      if (noEscapeTable[c] !== 1) {
        if (lastPos < i) {
          out += str.slice(lastPos, i);
        }
        lastPos = i + 1;
        out += hex[c];
      }

      if (++i === len) {
        break outer;
      }

      c = str.charCodeAt(i);
    }

    if (lastPos < i) {
      out += str.slice(lastPos, i);
    }

    if (c < 0x800) {
      lastPos = i + 1;
      out += hex[0xc0 | (c >> 6)]! + hex[0x80 | (c & 0x3f)]!;
      continue;
    }
    if (c < 0xd800 || c >= 0xe000) {
      lastPos = i + 1;
      out +=
        hex[0xe0 | (c >> 12)]! +
        hex[0x80 | ((c >> 6) & 0x3f)]! +
        hex[0x80 | (c & 0x3f)]!;
      continue;
    }

    // A high surrogate; the low one completes the code point.
    ++i;
    if (i >= len) {
      throw new ERR_INVALID_URI();
    }
    const c2 = str.charCodeAt(i) & 0x3ff;
    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3ff) << 10) | c2);
    out +=
      hex[0xf0 | (c >> 18)]! +
      hex[0x80 | ((c >> 12) & 0x3f)]! +
      hex[0x80 | ((c >> 6) & 0x3f)]! +
      hex[0x80 | (c & 0x3f)]!;
  }

  if (lastPos === 0) {
    return str;
  }
  if (lastPos < len) {
    return out + str.slice(lastPos);
  }
  return out;
}
