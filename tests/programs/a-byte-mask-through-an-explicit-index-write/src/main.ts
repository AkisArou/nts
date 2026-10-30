// Reduced from the Modern Web Crypto profile findings.
// Only the compound write through a non-null asserted target changes to an explicit indexed write.
// Paired refusal: tests/refusals/a-byte-mask-through-an-asserted-index.

export function mask(n: number): number {
  const bytes = new Uint8Array([255]);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! & n;
  return bytes[0] ?? 0;
}
