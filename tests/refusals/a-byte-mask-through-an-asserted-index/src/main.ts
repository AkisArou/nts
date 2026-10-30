// expect: NTS1001 assignment to a computed target is not supported by this lowering yet
// Reduced from the Modern Web Crypto profile findings.
// Only the compound write through a non-null asserted target changes to an explicit indexed write.
// Paired control: tests/programs/a-byte-mask-through-an-explicit-index-write.

export function mask(n: number): number {
  const bytes = new Uint8Array([255]);
  bytes[bytes.length - 1]! &= n;
  return bytes[0] ?? 0;
}
