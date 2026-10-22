// The fields of an object that never leaves its function are values.
//
// `walk` is `benchmarks/cases/user-iterable`: a hand-written iterator whose
// `next` answers `{ value, done }`. Everything inlines and nothing is
// allocated, and still `Steps.at` was a `double` field, so the range analysis
// never knew it was a whole number: `seed * 31 + at` was floating-point and its
// `| 0` took the slow path every step. With the fields as values, `at` is a
// loop counter, the whole-number copy of `walk` is integer arithmetic with no
// conversion left in it, and no object is left at all.
//
// `joined` writes a field on both arms of a branch and reads it after the
// join. The control keeps its object for one reason: `escaped` hands it to a
// function. `named` holds a string, and was a control until a reference field
// became a value too (`a-local-objects-reference-fields-are-values`).
//
// expect-ir: all: no object.new in walk
// expect-ir: all: no field.get in walk
// expect-ir: all: no convert in walk#whole
// expect-ir: all: no object.new in joined
// expect-ir: all: count object.new in escaped >= 1
// expect-ir: all: no object.new in named

type Step = { value: number; done: boolean };

class Steps {
  at: number;
  seed: number;
  constructor(at: number) {
    this.at = at;
    this.seed = 1;
  }
  next(): Step {
    this.at = this.at - 1;
    this.seed = (this.seed * 31 + this.at) | 0;
    return { value: this.seed & 255, done: this.at < 0 };
  }
}

class Series {
  from: number;
  constructor(from: number) {
    this.from = from;
  }
  [Symbol.iterator](): Steps {
    return new Steps(this.from);
  }
}

export function walk(rounds: number): number {
  let total = 0;
  for (const v of new Series(rounds & 1023)) {
    total = (total + v) | 0;
  }
  return total;
}

class Pair {
  low: number;
  high: number;
  constructor(low: number, high: number) {
    this.low = low;
    this.high = high;
  }
}

export function joined(a: number, b: number): number {
  const p = new Pair(a, b);
  if (a > b) {
    p.low = b;
    p.high = a;
  } else {
    p.high = p.high + 1;
  }
  return p.high - p.low;
}

function spread(p: Pair): number {
  return p.high - p.low;
}

export function escaped(a: number, b: number): number {
  const p = new Pair(a, b);
  p.high = p.high + 1;
  return spread(p);
}

class Named {
  label: string;
  size: number;
  constructor(label: string, size: number) {
    this.label = label;
    this.size = size;
  }
}

export function named(size: number): number {
  const n = new Named("x", size);
  n.size = n.size * 2;
  return n.label.length + n.size;
}
