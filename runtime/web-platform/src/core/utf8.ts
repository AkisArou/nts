// UTF-8 between bytes and NTS string code units.
//
// This is the provider-independent codec used by Web encoders, Node Buffer,
// URL parsing, and protocol code. A backend may recognize these operations as
// intrinsics, but their observable fallback semantics live here once.
//
// Both directions live here. `core/encoding.ts` has its own decoder because what a Web
// caller needs is decoding *plus* WHATWG policy -- the replacement character, `fatal`,
// and consuming a leading BOM. The two agree on every malformed sequence tried and
// differ only on the BOM, which is the policy that does not belong at this level.
//
// `utf8Decode` is the codec without that policy, and the Node lane's `Buffer` needs
// exactly that: `toString("utf8")` does not consume a BOM. It is re-exported through
// `runtime/node/internal/utf8.ts`, so it is consumed from outside this directory --
// which is why an audit scoped to this lane called it dead and was wrong.

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

export function utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  let output = "";
  let codePoint = 0;
  let bytesSeen = 0;
  let bytesNeeded = 0;
  let lowerBoundary = 0x80;
  let upperBoundary = 0xbf;
  let index = start;

  while (index < end) {
    const byte = bytes[index];
    if (byte === undefined) break;

    if (bytesNeeded === 0) {
      index++;
      if (byte <= 0x7f) {
        output += String.fromCharCode(byte);
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
        output += "\ufffd";
      }
      continue;
    }

    if (byte < lowerBoundary || byte > upperBoundary) {
      codePoint = 0;
      bytesNeeded = 0;
      bytesSeen = 0;
      lowerBoundary = 0x80;
      upperBoundary = 0xbf;
      output += "\ufffd";
      continue;
    }

    lowerBoundary = 0x80;
    upperBoundary = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    bytesSeen++;
    index++;

    if (bytesSeen === bytesNeeded) {
      if (codePoint > 0xffff) {
        const supplementary = codePoint - 0x10000;
        output += String.fromCharCode(
          0xd800 + (supplementary >> 10),
          0xdc00 + (supplementary & 0x3ff),
        );
      } else {
        output += String.fromCharCode(codePoint);
      }
      codePoint = 0;
      bytesNeeded = 0;
      bytesSeen = 0;
    }
  }

  if (bytesNeeded !== 0) output += "\ufffd";
  return output;
}
