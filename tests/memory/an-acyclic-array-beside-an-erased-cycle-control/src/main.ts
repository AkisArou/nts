// Control for `an-acyclic-array-beside-an-erased-cycle`, differing in one
// thing: `Knot` also holds `w`, after `next`. A `Knot` can then be read as a
// `Weighted` through the interface's family, though `w` is not its first
// field, so the erased cyclic `Knot` can arrive in a `Weighted` slot through
// the assertion's unerase, and `Weighted[]` keeps the cyclic descriptor:
// the release of `first` above zero buffers it as a candidate.

interface Weighted {
  w: number;
}

class Knot {
  next: Knot | null = null;
  w = 0;
}

class Holder {
  items: Weighted[];
  constructor(items: Weighted[]) {
    this.items = items;
  }
}

let parked: unknown = null;
let parkedKnot: unknown = null;
let kept: Holder | null = null;

export function work(n: number): number {
  // Erased only on a path that never runs: the analysis reads the operation,
  // and the measured run releases no `Knot` above zero of its own.
  if (n < -1e9) parkedKnot = new Knot();
  parked = { w: 3 + n };
  const first: Weighted[] = [{ w: 1 + n }];
  const second: Weighted[] = [{ w: 2 + n }];
  first.push(parked as Weighted);
  kept = new Holder(first);
  kept.items = second;
  const answer = kept.items.length + first.length + first[0].w;
  kept = null;
  parked = null;
  return answer;
}
