// Presence: which optional properties a value has, which its slots cannot say.
// Wasm keeps one word per storage family that records it, right after the
// header. These are the shapes that would put the word in the wrong place or
// read the wrong family's: a subclass written through its base, an interface
// over a class, an open value of either of two families, and values of none.

class Shape {
  kind: number;
  label?: string;

  constructor(kind: number) {
    this.kind = kind;
  }
}

// Its own optional properties come after its base's, and its fields after
// those: the base's bit and the base's fields keep their places.
class Tagged extends Shape {
  extra?: number;
  note?: string;
  weight: number;

  constructor(kind: number) {
    super(kind);
    this.weight = kind * 2;
  }
}

// Unrelated, with a word of its own at the same field and its own numbering.
class Other {
  size: number;
  note?: string;
  label?: string;

  constructor(size: number) {
    this.size = size;
  }
}

// Asked about by nothing: it carries no word.
class Plain {
  size: number;

  constructor(size: number) {
    this.size = size;
  }
}

// Enough optional properties to reach the high bits.
class Wide {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
  g?: number;
  h?: number;
  i?: number;
  j?: number;
  k?: number;
  l?: number;
  m?: number;
  n?: number;
  o?: number;
  p?: number;
  q?: number;
  r?: number;
  s?: number;
  t?: number;
  u?: number;
  v?: number;
  w?: number;
  x?: number;
  y?: number;
  z?: number;
}

function clearLabel(s: Shape): void {
  delete s.label;
}

function relabel(s: Shape, text: string): void {
  s.label = text;
}

function labelled(s: Shape): number {
  return "label" in s ? 1 : 0;
}

// The subclass's own bits, and its base's, through its own type.
export function ownAndInherited(n: number): number {
  const t = new Tagged(n);
  if (n > 3) {
    delete t.extra;
  }
  if (n > 5) {
    clearLabel(t);
  }
  return ("label" in t ? 1 : 0) + ("extra" in t ? 2 : 0) + ("note" in t ? 4 : 0) + t.weight * 8;
}

// Cleared and written again through the base, read through the subclass.
export function rewrittenThroughTheBase(n: number): string {
  const t = new Tagged(n);
  clearLabel(t);
  const before = labelled(t);
  if (n > 2) {
    relabel(t, "back");
  }
  return `${before}|${"label" in t}|${t.label}|${t.kind}|${t.weight}`;
}

function open(n: number): object {
  const at = ((n % 6) + 6) % 6;
  if (at === 0) {
    return new Shape(n);
  }
  if (at === 1) {
    const t = new Tagged(n);
    delete t.label;
    return t;
  }
  if (at === 2) {
    return new Other(n);
  }
  if (at === 3) {
    const o = new Other(n);
    delete o.label;
    return o;
  }
  if (at === 4) {
    return new Plain(n);
  }
  return [n, n + 1];
}

// `"k" in v` over a value whose type says nothing: each family reads its own
// word, and a value of none answers false.
export function anOpenValue(n: number): string {
  const v = open(n);
  return `${"label" in v}|${"note" in v}|${"extra" in v}|${"kind" in v}`;
}

// Bits 0 and 25 and one between, written and deleted.
export function theHighBits(n: number): number {
  const w = new Wide();
  if (n > 1) {
    w.a = n;
  }
  if (n > 2) {
    w.m = n;
  }
  if (n > 3) {
    w.z = n;
  }
  if (n > 6) {
    delete w.z;
  }
  return ("a" in w ? 1 : 0) + ("m" in w ? 2 : 0) + ("z" in w ? 4 : 0) + ("y" in w ? 8 : 0);
}
