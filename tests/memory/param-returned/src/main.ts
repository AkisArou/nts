// A function that hands back one of its arguments.
//
// `pick` returns a borrow of a parameter, and the caller can keep borrowing
// across the call if -- and only if -- something can say which parameter. That
// is the `returns` column of the per-function summary in record 0024, and it is
// the whole of why `borrowed-call` eliminates nothing: a call today ends every
// borrow because nothing can state this sentence.

class Box {
  value: number;
  constructor(v: number) { this.value = v; }
}

function pick(a: Box, b: Box, first: boolean): Box {
  if (first) {
    return a;
  }
  return b;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const x = new Box(i);
    const y = new Box(i + 1);
    const chosen = pick(x, y, i % 2 === 0);
    total = total + chosen.value;
  }
  return total;
}
