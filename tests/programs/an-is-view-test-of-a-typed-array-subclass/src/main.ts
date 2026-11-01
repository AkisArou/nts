// `ArrayBuffer.isView` is true of a typed-array subclass's instance, as of any
// typed array: its descriptor is a view's.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1);
  return (ArrayBuffer.isView(bytes) ? 1 : 0) + (ArrayBuffer.isView({ length: n }) ? 2 : 0);
}
