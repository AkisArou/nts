import { decodeUTF8 } from "../core/encoding.ts";
import { FormData } from "./form-data.ts";

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function decodeComponent(input: Uint8Array, start: number, end: number): string {
  let firstEscape = start;
  while (firstEscape < end && input[firstEscape] !== 0x25 && input[firstEscape] !== 0x2b) {
    firstEscape++;
  }
  if (firstEscape === end) return decodeUTF8(input.subarray(start, end), false, true);

  const output = new Uint8Array(end - start);
  output.set(input.subarray(start, firstEscape));
  let written = firstEscape - start;
  for (let index = firstEscape; index < end; index++) {
    const byte = input[index]!;
    if (byte === 0x2b) {
      output[written++] = 0x20;
    } else if (byte === 0x25 && index + 2 < end) {
      const high = hexValue(input[index + 1]!);
      const low = hexValue(input[index + 2]!);
      if (high >= 0 && low >= 0) {
        output[written++] = high * 16 + low;
        index += 2;
      } else output[written++] = byte;
    } else output[written++] = byte;
  }
  // This is UTF-8 decode without BOM: a leading U+FEFF is form data. Decode
  // after percent decoding so raw and escaped UTF-8 bytes can form one scalar.
  return decodeUTF8(output.subarray(0, written), false, true);
}

/** Fetch's byte-input application/x-www-form-urlencoded parser (URL §5.1). */
export function decodeURLEncoded(input: Uint8Array): FormData {
  const result = new FormData();
  let start = 0;
  while (start < input.length) {
    let end = start;
    let separator = -1;
    while (end < input.length && input[end] !== 0x26) {
      if (separator < 0 && input[end] === 0x3d) separator = end;
      end++;
    }
    if (end !== start) {
      const nameEnd = separator < 0 ? end : separator;
      const valueStart = separator < 0 ? end : separator + 1;
      result.append(decodeComponent(input, start, nameEnd), decodeComponent(input, valueStart, end));
    }
    start = end + 1;
  }
  return result;
}
