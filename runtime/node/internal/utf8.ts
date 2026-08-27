// UTF-8 between bytes and UTF-16 code units.
//
// A JavaScript string is UTF-16; almost everything a program writes out is
// UTF-8. Node does this conversion in C++ against V8's string representation.
// Here it is TypeScript over a byte array, which is the same algorithm without
// the engine's internals to exploit.

/** The number of UTF-8 bytes a string needs. */
export function utf8Length(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      len += 1;
    } else if (c < 0x800) {
      len += 2;
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        // A surrogate pair is one code point and four bytes.
        len += 4;
        i++;
        continue;
      }
      // A lone high surrogate encodes as the replacement character.
      len += 3;
    } else {
      len += 3;
    }
  }
  return len;
}

/**
 * Write `str` as UTF-8 into `out` at `offset`, up to `max` bytes.
 * Returns how many bytes were written.
 *
 * A partial code point is never written: if the next character does not fit
 * whole, the write stops. Splitting one across a boundary would produce bytes
 * that decode to something else.
 */
export function utf8Write(
  out: Uint8Array,
  str: string,
  offset: number,
  max: number,
): number {
  let at = offset;
  const end = offset + max;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);

    if (c >= 0xd800 && c < 0xdc00) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    } else if (c >= 0xdc00 && c < 0xe000) {
      // A lone low surrogate is not a code point.
      c = 0xfffd;
    }

    if (c < 0x80) {
      if (at + 1 > end) break;
      out[at++] = c;
    } else if (c < 0x800) {
      if (at + 2 > end) break;
      out[at++] = 0xc0 | (c >> 6);
      out[at++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      if (at + 3 > end) break;
      out[at++] = 0xe0 | (c >> 12);
      out[at++] = 0x80 | ((c >> 6) & 0x3f);
      out[at++] = 0x80 | (c & 0x3f);
    } else {
      if (at + 4 > end) break;
      out[at++] = 0xf0 | (c >> 18);
      out[at++] = 0x80 | ((c >> 12) & 0x3f);
      out[at++] = 0x80 | ((c >> 6) & 0x3f);
      out[at++] = 0x80 | (c & 0x3f);
    }
  }
  return at - offset;
}

/**
 * Decode UTF-8, replacing every byte of an invalid sequence with U+FFFD.
 *
 * Replacing rather than throwing is what every decoder that has to keep going
 * does, and it is what `Buffer.prototype.toString` promises.
 */
export function utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  let i = start;
  while (i < end) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }

    let needed: number;
    let code: number;
    let lowest: number;
    if ((b0 & 0xe0) === 0xc0) {
      needed = 1;
      code = b0 & 0x1f;
      lowest = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      needed = 2;
      code = b0 & 0x0f;
      lowest = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      needed = 3;
      code = b0 & 0x07;
      lowest = 0x10000;
    } else {
      out += "�";
      i += 1;
      continue;
    }

    if (i + needed >= end + 1 && i + needed > end - 1) {
      out += "�";
      i += 1;
      continue;
    }

    let valid = true;
    for (let k = 1; k <= needed; k++) {
      const b = bytes[i + k]!;
      if ((b & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (b & 0x3f);
    }

    // An overlong encoding, a surrogate, or a value past the last code point
    // is invalid however well-formed its bytes are.
    if (!valid || code < lowest || (code >= 0xd800 && code < 0xe000) || code > 0x10ffff) {
      out += "�";
      i += 1;
      continue;
    }

    i += needed + 1;
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
