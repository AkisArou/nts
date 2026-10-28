// expect: `indexOf` on a typed array, which this compiler does not provide yet
// CLBG reverse-complement searches for line endings in a byte array.
// Control: the same indexOf call on an ordinary numeric array.
export function byteIndex(n: number): number {
  const bytes = new Uint8Array([1, 2, 3]);
  return bytes.indexOf(n);
}
