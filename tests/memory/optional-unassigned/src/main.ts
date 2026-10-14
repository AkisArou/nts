// An optional field the constructor never writes, read in a loop.
//
// The absence has to cost nothing: it is the state the allocator already
// leaves, and reading it is a tag test.

class Inner {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

class Slot {
  ref?: Inner;
  count?: number;
  given: number;
  constructor(given: number) {
    this.given = given;
  }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const s = new Slot(i);
    total = total + (s.count ?? 1) + (s.ref?.v ?? 2) + s.given;
  }
  return total;
}
