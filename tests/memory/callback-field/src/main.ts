// A callback held in a field, called with a reference argument.
//
// The allocation half is ordinary: `Box` does not escape, so it lives in the
// frame. The counting half is the interesting one, and it is a claim about
// *devirtualisation* rather than about closures.
//
// A dispatch is opaque. `own::mutating` has to assume a call it cannot name
// reaches a store, so a reference handed to one cannot be borrowed across it --
// which is the same shape record 0091 found, where a virtual call two hops away
// cost 34 operations on objects escape analysis had already framed.
//
// Once the field is known to hold one closure the call is direct, `read` is a
// function whose body is visible, and it stores nothing. So the reference is
// borrowed and nothing is counted.

class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

type Holder = { tag: number; fn?: (b: Box) => number };

function read(b: Box): number {
  return b.v;
}

export function work(n: number): number {
  const h: Holder = { tag: 1 };
  h.fn = read;
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const b = new Box(i);
    total = total + (h.fn?.(b) ?? 0);
  }
  return total;
}
