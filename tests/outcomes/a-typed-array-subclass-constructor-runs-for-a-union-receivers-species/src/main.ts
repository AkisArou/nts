// run: check
//
// Recorded wrong, on main and with #155 alike: the species result is the same
// view with the receiver's class, and the constructor its class declares is not
// run for it (#186, species entries). Its control is
// programs/a-typed-array-subclass-constructor-runs-for-a-union-receivers-species-control.
// The receiver is `Uint8Array | Counted`, so which species constructs the
// result is known only at run time: the descriptor's species slot.
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
function pick(n: number): Uint8Array | Counted {
  return (n & 1) === 0 ? new Counted((n & 3) + 4) : new Uint8Array((n & 3) + 4);
}
export function probe(n: number): number {
  made = 0;
  const value = pick(n | 0);
  const shared = value.subarray(1);
  return (shared instanceof Counted ? 1 : 0) + made * 10 + shared.length * 100;
}
