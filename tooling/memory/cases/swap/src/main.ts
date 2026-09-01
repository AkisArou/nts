// Two slots exchanged, which is `load [take]` with nothing else in it.
//
// Both loads are of a slot that is overwritten before anything else reads it,
// so both references move rather than being copied. There is no borrow here to
// find and no lifetime to prove: the counting is unnecessary because the
// references never multiply, and a compiler that emits a retain for either load
// is paying to duplicate something it immediately throws away.

class Thing {
  value: number;
  constructor(v: number) { this.value = v; }
}

class Pair {
  a: Thing | null;
  b: Thing | null;
  constructor() { this.a = null; this.b = null; }
}

export function work(n: number): number {
  const pair = new Pair();
  pair.a = new Thing(1);
  pair.b = new Thing(2);
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const held: Thing | null = pair.a;
    pair.a = pair.b;
    pair.b = held;
    total = total + (pair.a === null ? 0 : pair.a.value);
  }
  return total;
}
