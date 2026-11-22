// An array of a type that holds no reference is not a cycle candidate, even in
// a program that erases a cyclic object and narrows an erased value to the
// array's element type (#926).
//
// `Weighted[]` holds `{ w }` objects, which hold a number, so nothing it can
// reach is cyclic. But this program also erases a `Knot` -- cyclic, through
// `next` -- into `parkedKnot`, and asserts the erased `parked` to be a `Weighted`. The cycle analysis paired every type erased anywhere with
// every type unerased anywhere, so a `Weighted` slot could hold a `Knot` and
// every `Weighted[]` got the cyclic array descriptor. A `Knot` has no `w`, so
// nothing can read it as a `Weighted`, and no unerase can produce one there.
//
// The release that matters is `kept.items = second`: `first` is still held by
// its local, so the store's release of it lands above zero, which buffers a
// cyclic-described array as a candidate and passes over an acyclic one.
//
// The control (`...-control`) differs in one thing: its `Knot` also holds `w`,
// after `next`, so it can be read as a `Weighted` through the interface's
// family, and its `Weighted[]` stays a candidate.

interface Weighted {
  w: number;
}

class Knot {
  next: Knot | null = null;
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
