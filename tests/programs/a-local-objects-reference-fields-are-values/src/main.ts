// The fields of an object that never leaves its function are values, a
// reference or an erased value as much as a number.
//
// `labelled` holds a string, and `unset` reads an erased field nothing wrote,
// which answers the zero of its type -- `undefined` -- as node does. Neither is
// an object any more. The controls keep theirs, each for one reason:
// `compared` asks for the object's identity, and `published` stores it where
// anything can read it later.
//
// `held` is `benchmarks/cases/optional-chain`, and keeps its object for a
// second reason this does not remove: `h.fn?.(…)` hands `h` to the call as its
// `this`. Only a call known to reach a callee that never reads `this` lets it
// go, which is devirtualization's to decide, not this pass's.
//
// expect-ir: all: no object.new in unset
// expect-ir: all: no object.new in labelled
// expect-ir: all: count object.new in held >= 1
// expect-ir: all: count object.new in compared >= 1
// expect-ir: all: count object.new in published >= 1

interface Held {
  fn?: (x: number) => number;
}

function plusOne(x: number): number {
  return x + 1;
}

export function held(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    const h: Held = {};
    if ((total & 1) === 0) {
      h.fn = plusOne;
    }
    total = total + (h.fn?.(total & 7) ?? 1);
  }
  return total;
}

export function unset(n: number): number {
  const h: Held = {};
  return typeof h.fn === "undefined" ? n + 1 : n;
}

class Labelled {
  label: string;
  size: number;
  constructor(label: string, size: number) {
    this.label = label;
    this.size = size;
  }
}

export function labelled(size: number): number {
  const l = new Labelled(size > 3 ? "wide" : "x", size);
  l.size = l.size * 2;
  return l.label.length + l.size;
}

let last: Labelled | null = null;

export function compared(size: number): number {
  const l = new Labelled("x", size);
  const same = last === l;
  return same ? 0 : size + 1;
}

export function published(size: number): number {
  last = new Labelled("z", size);
  return size + 1;
}
