// expect: a spread element is not supported by this lowering yet
// CLBG reverse-complement's byte-to-string conversion. The explicit-byte
// control is in programs/clbg-reverse-complement-controls.
export function spreadByte(n: number): string {
  const bytes = new Uint8Array([n & 255]);
  return String.fromCharCode(...bytes);
}
