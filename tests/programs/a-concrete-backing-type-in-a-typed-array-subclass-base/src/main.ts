// Control for a-type-parameter-in-a-typed-array-subclass-base: fix the backing
// parameter to ArrayBuffer in the declaration, as the subject's caller does.
// The allocation and byte access are identical.

class Bytes extends Uint8Array<ArrayBuffer> {
  constructor(backing: ArrayBuffer) {
    super(backing);
  }
}

export function backingByte(n: number): number {
  const bytes = new Bytes(new ArrayBuffer(4));
  bytes[0] = n;
  return bytes[0]! + bytes.length;
}
