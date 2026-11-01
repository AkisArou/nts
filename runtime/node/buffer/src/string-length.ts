// Node v26.13.0 src/string_bytes.cc:603-700 measures the UTF-16 result
// before constructing a large decoded string. V8's limit counts code units,
// not input bytes; a valid three-byte sequence can still fit at the boundary.
export const kStringMaxLength = 536870888;

/** UTF-16 units emitted by the replacement-mode UTF-8 decoder, without a string. */
export function utf8DecodedLength(bytes: Uint8Array, start: number, end: number): number {
  let length = 0;
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
        length++;
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        bytesNeeded = 1;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lowerBoundary = 0xa0;
        if (byte === 0xed) upperBoundary = 0x9f;
        bytesNeeded = 2;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lowerBoundary = 0x90;
        if (byte === 0xf4) upperBoundary = 0x8f;
        bytesNeeded = 3;
      } else {
        length++;
      }
      continue;
    }
    if (byte < lowerBoundary || byte > upperBoundary) {
      length++;
      bytesNeeded = 0;
      bytesSeen = 0;
      lowerBoundary = 0x80;
      upperBoundary = 0xbf;
      continue;
    }
    lowerBoundary = 0x80;
    upperBoundary = 0xbf;
    bytesSeen++;
    index++;
    if (bytesSeen === bytesNeeded) {
      length += bytesNeeded === 3 ? 2 : 1;
      bytesNeeded = 0;
      bytesSeen = 0;
    }
  }
  return length + (bytesNeeded === 0 ? 0 : 1);
}
