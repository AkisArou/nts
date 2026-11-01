// expect: NTS1001 a base `Uint8Array` of unrepresentable type (`Uint8Array`) is not supported by this lowering yet
//
// A typed-array subclass that declares an instance field is not its builtin's
// storage, so no instance of it is made -- which is what keeps a species result
// (the receiver's view with its class) from carrying a field nothing wrote.
// Control: programs/a-typed-array-subclass-keeps-its-class-through-subarray-and-slice.
class Tagged extends Uint8Array { tag = "t"; }
export function probe(n: number): number {
  const t = new Tagged((n & 3) + 4);
  return (t.subarray(1) as Tagged).tag.length + (t.slice(1) as Tagged).tag.length;
}
