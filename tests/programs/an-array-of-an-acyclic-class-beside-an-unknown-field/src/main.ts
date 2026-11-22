// A `Leaf[]` whose element holds only a number cannot be in a cycle, and is
// given the acyclic array descriptor -- even though this program erases a
// cyclic `Link` into an `unknown` field and narrows that field to `Leaf`.
// The cycle analysis used to pair every erased type with every unerased one,
// so `slot(Leaf)` reached `Link` and every `Leaf[]` here was buffered as a
// cycle candidate on each release that did not free it (#926).
//
// Controls, with names no layout shares with `Leaf`:
// - `Holder[]`: its element holds the `unknown` field itself, so it reaches
//   anything and keeps the cyclic descriptor.
// - `Weighted[]`: a cyclic `Knot` erased and narrowed to the interface by a
//   type guard really is held there, though its fields do not begin with
//   `w`; it keeps the cyclic descriptor.
class Leaf {
  constructor(public n: number) {}
}

class Link {
  next: Link | null = null;
  payload: unknown = null;
  constructor(public value: number) {}
}

export function leaves(x: number): number {
  const a = new Link(x);
  const b = new Link(x + 1);
  a.next = b;
  b.payload = (x & 1) === 0 ? a : new Leaf(x * 2);
  const xs: Leaf[] = [];
  for (let i = 0; i < 8; i++) xs.push(new Leaf(x + i));
  const p = b.payload;
  if (p instanceof Leaf) xs.push(p);
  let sum = 0;
  for (const leaf of xs) sum += leaf.n;
  return sum + (p instanceof Link ? p.value : 0);
}

// No `n`: a `Holder` holding one could be read as a `Leaf`.
class Holder {
  payload: unknown = null;
  constructor(public h: number) {}
}

export function holders(x: number): number {
  const hs: Holder[] = [];
  for (let i = 0; i < 4; i++) hs.push(new Holder(x + i));
  hs[0].payload = hs;
  let sum = 0;
  for (const h of hs) sum += h.h + (h.payload === hs ? 1 : 0);
  return sum;
}

interface Weighted {
  w: number;
}

class Knot {
  next: Knot | null = null;
  w: number;
  constructor(w: number) {
    this.w = w;
  }
}

function isWeighted(v: unknown): v is Weighted {
  return typeof v === "object" && v !== null && "w" in v;
}

export function weighted(x: number): number {
  const box: { held: unknown } = { held: null };
  const k = new Knot(x);
  k.next = k;
  box.held = (x & 1) === 0 ? k : "none";
  const ws: Weighted[] = [{ w: 1 }];
  const held = box.held;
  if (isWeighted(held)) ws.push(held);
  let sum = 0;
  for (const one of ws) sum += one.w;
  return sum;
}
