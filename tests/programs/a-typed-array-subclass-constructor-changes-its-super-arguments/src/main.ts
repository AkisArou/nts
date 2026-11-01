// A subclass of a typed array adds no storage, so its instance is the view
// its `super(...)` builds -- from the arguments the constructor passes, not the
// ones `new` was given. Building the view from `new`'s arguments skipped the
// body: node answers a length of 2n, and that answered n.
// The control doubles at the call site and declares no constructor.
let made = 0;
class Doubled extends Uint8Array {
  constructor(size: number) {
    made += 1;
    super(size * 2);
  }
}
export function probe(n: number): number {
  made = 0;
  const bytes = new Doubled((n & 7) + 1);
  return bytes.length * 100 + made;
}
