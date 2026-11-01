// run: check
//
// Recorded wrong, on main and with #155 alike: the species result is the same
// view with the receiver's class, and the constructor its class declares is not
// run for it (#186, species entries). Its control is
// programs/a-typed-array-subclass-constructor-runs-for-its-species-control.
// A class that declares a constructor is constructed by it for its species:
// `subarray` calls `new Counted(buffer, byteOffset, length)`, so the
// constructor runs a second time and the result shares the bytes.
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
  const counted = new Counted((n & 3) + 4);
  const shared = counted.subarray(1);
  counted[1] = 6;
  return (shared instanceof Counted ? 1 : 0) + made * 10 + shared[0]! * 100 + shared.length * 1000;
}
