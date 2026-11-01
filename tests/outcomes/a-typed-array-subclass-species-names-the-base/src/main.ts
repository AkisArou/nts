// run: check
//
// Recorded wrong, on main and with #155 alike: the species result is the same
// view with the receiver's class, and the constructor its class declares is not
// run for it (#186, species entries). Its control is
// programs/a-typed-array-subclass-species-names-the-base-control.
// `static [Symbol.species]` names the class `subarray` and `slice` construct:
// here the base, so the results are plain `Uint8Array`s.
class Bytes extends Uint8Array {
  static get [Symbol.species]() { return Uint8Array; }
}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 4);
  const shared = bytes.subarray(1);
  const copied = bytes.slice(1);
  return (shared instanceof Bytes ? 1 : 0) + (copied instanceof Bytes ? 2 : 0)
    + (shared instanceof Uint8Array ? 4 : 0) + (bytes instanceof Bytes ? 8 : 0);
}
