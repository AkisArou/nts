// expect: NTS1001 a base `Uint8Array` of unrepresentable type (`Uint8Array`) is not supported by this lowering yet
//
// The same, for a parameter property.
// Control: programs/a-typed-array-subclass-keeps-its-class-through-subarray-and-slice.
class Tagged extends Uint8Array {
  constructor(length: number, public tag: string = "t") { super(length); }
}
export function probe(n: number): number {
  const t = new Tagged((n & 3) + 4);
  return (t.subarray(1) as Tagged).tag.length + (t.slice(1) as Tagged).tag.length;
}
