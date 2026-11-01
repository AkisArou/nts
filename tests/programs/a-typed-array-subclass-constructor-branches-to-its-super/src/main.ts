// The shape of `runtime/node`'s `Buffer`: a constructor whose branches each
// call `super(...)` with their own arguments, check them first, and work on
// `this` after it. Each path makes the instance exactly once.
// The control runs the same branches in a factory over a subclass with no
// constructor.
let made = 0;
function checked(size: number): number {
  if (size < 0 || size > 64) throw new RangeError("size " + size);
  return size;
}
class Bytes extends Uint8Array {
  constructor(value: number | string, fill?: number) {
    if (typeof value === "number") {
      super(checked(value));
      made += 1;
      if (fill !== undefined) this.fill(fill);
      return;
    }
    const size = value.length;
    super(size);
    for (let i = 0; i < size; i++) this[i] = value.charCodeAt(i);
    made += 100;
  }
}
function sum(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i]!;
  return total;
}
export function fromNumber(n: number): number {
  made = 0;
  try {
    const bytes = new Bytes((n % 80) - 8, n & 3);
    return bytes.length * 1000 + sum(bytes) * 10 + made;
  } catch {
    return -1;
  }
}
export function fromString(n: number): number {
  made = 0;
  const bytes = new Bytes("ab".repeat((n & 3) + 1));
  return bytes.length * 1000 + sum(bytes) + made;
}
