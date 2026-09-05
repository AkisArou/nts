// Two instantiations of one generic class, in one loop.
//
// A generic class is lowered once per instantiation, so `Box<number>` and
// `Box<boolean>` are two classes that happen to share a source. The thing this
// case holds is that being a copy costs nothing: a copy is an ordinary class,
// and an ordinary class whose instance dies with the iteration lives in a
// frame slot.
//
// The implementation this would catch is the other one. Erasing `T` and boxing
// the field -- one representation for both copies, with the value behind a
// pointer -- gives the same answers on every input and shows up here as an
// allocation per box and nowhere else.
//
// Both parameters are scalar on purpose. A `Box<string>` would allocate its
// string, and the case would then be measuring the string.

class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v;
  }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const counted = new Box<number>(i);
    const flagged = new Box<boolean>(i % 2 === 0);
    total = total + counted.get() + (flagged.get() ? 1 : 0);
  }
  return total;
}
