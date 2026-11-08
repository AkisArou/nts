// expect: NTS1001 a base `Uint8Array` of unrepresentable type (`Uint8Array`)
// The caller fixes the backing type to ArrayBuffer, but the superclass still
// reaches lowering with the class's type parameter. Reduced from FastBuffer.
// Control: a-concrete-backing-type-in-a-typed-array-subclass-base fixes that
// parameter in the declaration; the allocation and byte access are identical.

class Bytes<T extends ArrayBufferLike = ArrayBufferLike> extends Uint8Array<T> {
  constructor(backing: T) {
    super(backing);
  }
}

export function backingByte(n: number): number {
  const bytes = new Bytes<ArrayBuffer>(new ArrayBuffer(4));
  bytes[0] = n;
  return bytes[0]! + bytes.length;
}
