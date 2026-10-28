export function explicitByte(n: number): string {
  const bytes = new Uint8Array([n & 255]);
  return String.fromCharCode(bytes[0]);
}

export function arrayIndex(n: number): number {
  const bytes: number[] = [1, 2, 3];
  return bytes.indexOf(n);
}
