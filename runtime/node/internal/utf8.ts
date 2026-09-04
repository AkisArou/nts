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
 * Decode UTF-8, substituting U+FFFD for each maximal invalid subpart.
 *
 * This is the WHATWG Encoding standard's decoder, state variable for state
 * variable, and the *number* of replacement characters is the reason it is
 * written that way rather than as a switch on the lead byte. `E8 AA 62` is one
 * bad sequence followed by `b`, so it decodes to two characters: a decoder that
 * restarts one byte after the lead emits three, and no test using ASCII would
 * ever catch the difference.
 *
 * The boundaries move with the lead byte — `E0` requires `A0..BF` where `E1`
 * accepts `80..BF` — which is what rules out an overlong encoding without a
 * separate check afterwards.
 */
export function utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  let codePoint = 0;
  let bytesSeen = 0;
  let bytesNeeded = 0;
  let lowerBoundary = 0x80;
  let upperBoundary = 0xbf;

  let i = start;
  while (i < end) {
    const byte = bytes[i]!;

    if (bytesNeeded === 0) {
      i++;
      if (byte <= 0x7f) {
        out += String.fromCharCode(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        bytesNeeded = 1;
        codePoint = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lowerBoundary = 0xa0;
        if (byte === 0xed) upperBoundary = 0x9f;
        bytesNeeded = 2;
        codePoint = byte & 0x0f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lowerBoundary = 0x90;
        if (byte === 0xf4) upperBoundary = 0x8f;
        bytesNeeded = 3;
        codePoint = byte & 0x07;
      } else {
        // C0, C1 and F5..FF cannot begin a sequence at all.
        out += "\ufffd";
      }
      continue;
    }

    if (byte < lowerBoundary || byte > upperBoundary) {
      // The sequence ends here and this byte is not part of it, so it is
      // *reprocessed* as a fresh start rather than consumed.
      codePoint = 0;
      bytesNeeded = 0;
      bytesSeen = 0;
      lowerBoundary = 0x80;
      upperBoundary = 0xbf;
      out += "\ufffd";
      continue;
    }

    lowerBoundary = 0x80;
    upperBoundary = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    bytesSeen++;
    i++;

    if (bytesSeen === bytesNeeded) {
      if (codePoint > 0xffff) {
        const c = codePoint - 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else {
        out += String.fromCharCode(codePoint);
      }
      codePoint = 0;
      bytesNeeded = 0;
      bytesSeen = 0;
    }
  }

  // A sequence cut off by the end of the input is one error, however many
  // bytes of it arrived.
  if (bytesNeeded !== 0) {
    out += "\ufffd";
  }
  return out;
}
