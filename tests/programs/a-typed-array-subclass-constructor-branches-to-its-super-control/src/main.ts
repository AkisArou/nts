// Control: the same branches in a factory, over a subclass with no
// constructor.
let made = 0;
function checked(size: number): number {
  if (size < 0 || size > 64) throw new RangeError("size " + size);
  return size;
}
class Bytes extends Uint8Array {}
function make(value: number | string, fill?: number): Bytes {
  if (typeof value === "number") {
    const bytes = new Bytes(checked(value));
    made += 1;
    if (fill !== undefined) bytes.fill(fill);
    return bytes;
  }
  const size = value.length;
  const bytes = new Bytes(size);
  for (let i = 0; i < size; i++) bytes[i] = value.charCodeAt(i);
  made += 100;
  return bytes;
}
function sum(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i]!;
  return total;
}
export function fromNumber(n: number): number {
  made = 0;
  try {
    const bytes = make((n % 80) - 8, n & 3);
    return bytes.length * 1000 + sum(bytes) * 10 + made;
  } catch {
    return -1;
  }
}
export function fromString(n: number): number {
  made = 0;
  const bytes = make("ab".repeat((n & 3) + 1));
  return bytes.length * 1000 + sum(bytes) + made;
}
