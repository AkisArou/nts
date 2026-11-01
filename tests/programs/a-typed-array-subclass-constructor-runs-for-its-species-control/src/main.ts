// Control for a-typed-array-subclass-constructor-runs-for-its-species: a plain
// `Uint8Array` receiver, whose species runs no constructor of the program's.
let made = 0;
class Counted extends Uint8Array {
  constructor(source: number | ArrayBuffer, offset = 0, length = -1) {
    made++;
    if (typeof source === "number") {
      super(source);
      return;
    }
    super(source, offset, length < 0 ? source.byteLength - offset : length);
  }
}
export function probe(n: number): number {
  made = 0;
  const counted = new Uint8Array((n & 3) + 4);
  const shared = counted.subarray(1);
  counted[1] = 6;
  return (shared instanceof Counted ? 1 : 0) + made * 10 + shared[0]! * 100 + shared.length * 1000;
}
