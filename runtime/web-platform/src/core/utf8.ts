// UTF-8 between bytes and NTS string code units.
//
// This is the provider-independent codec used by Web encoders, Node Buffer,
// URL parsing, and protocol code. A backend may recognize these operations as
// intrinsics, but their observable fallback semantics live here once.
//
// Encoding only. Decoding lives in `core/encoding.ts`, because what callers need is
// decoding *plus* the WHATWG policy around it -- the replacement character, `fatal`,
// and whether a leading BOM is consumed. A decoder here as well was written and never
// called; it agreed with the used one on every malformed sequence tried and differed
// only on the BOM, which is precisely the policy that does not belong at this level.

/** The number of UTF-8 bytes a string needs. */
export function utf8Length(input: string): number {
  let length = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      length++;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code < 0xdc00 && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        length += 4;
        index++;
        continue;
      }
      length += 3;
    } else {
      length += 3;
    }
  }
  return length;
}

/** Code units consumed and bytes written by a bounded UTF-8 write. */
export interface Utf8WriteProgress {
  read: number;
  written: number;
}

/**
 * Write `input` as UTF-8 into `output` at `offset`, up to `maximum` bytes.
 *
 * A partial code point is never written. The return value is the number of
 * bytes written, not the final output offset. `progress` is optional so hot
 * paths such as Node Buffer do not allocate a result object; `encodeInto()`
 * supplies the object it must return and receives the code-unit count too.
 */
export function utf8Write(
  output: Uint8Array,
  input: string,
  offset: number,
  maximum: number,
  progress?: Utf8WriteProgress,
): number {
  let outputIndex = offset;
  let inputIndex = 0;
  const end = offset + maximum;

  while (inputIndex < input.length) {
    let code = input.charCodeAt(inputIndex);
    let inputUnits = 1;

    if (code >= 0xd800 && code < 0xdc00) {
      const next = inputIndex + 1 < input.length ? input.charCodeAt(inputIndex + 1) : 0;
      if (next >= 0xdc00 && next < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00;
        inputUnits = 2;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code < 0xe000) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      if (outputIndex + 1 > end) break;
      output[outputIndex++] = code;
    } else if (code < 0x800) {
      if (outputIndex + 2 > end) break;
      output[outputIndex++] = 0xc0 | (code >> 6);
      output[outputIndex++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      if (outputIndex + 3 > end) break;
      output[outputIndex++] = 0xe0 | (code >> 12);
      output[outputIndex++] = 0x80 | ((code >> 6) & 0x3f);
      output[outputIndex++] = 0x80 | (code & 0x3f);
    } else {
      if (outputIndex + 4 > end) break;
      output[outputIndex++] = 0xf0 | (code >> 18);
      output[outputIndex++] = 0x80 | ((code >> 12) & 0x3f);
      output[outputIndex++] = 0x80 | ((code >> 6) & 0x3f);
      output[outputIndex++] = 0x80 | (code & 0x3f);
    }

    inputIndex += inputUnits;
  }

  const written = outputIndex - offset;
  if (progress !== undefined) {
    progress.read = inputIndex;
    progress.written = written;
  }
  return written;
}

/**
 * Decode UTF-8, substituting U+FFFD for each maximal invalid subpart.
 *
 * This follows the WHATWG decoder state machine. In particular, a rejected
 * continuation byte is reprocessed as a possible new leading byte, and a
 * sequence cut off by the end of the input emits one replacement character.
 */
