// `noUncheckedIndexedAccess` is on, so `xs[i]` is `number | undefined` and the
// `!` is the author asserting the index is in bounds. A native compiler has no
// `undefined` to put in a double, so that assertion has to be *checked* rather
// than assumed -- see docs/any-unknown.md on assertions.

export function total(): number {
  const xs = [1, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
  }
  return sum;
}

// Fills, then reads back. Exercises the store and the load against the same
// array, and `length` as a loop bound.
export function squares(): number {
  const xs = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    xs[i] = i * i;
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
  }
  return sum;
}

// The array arrives from outside, so its length is unknown here.
export function sum(xs: number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total += xs[i]!;
  }
  return total;
}

export function at(xs: number[], i: number): number {
  return xs[i]!;
}

export function lengthOf(xs: number[]): number {
  return xs.length;
}

export function empty(): number {
  const xs: number[] = [];
  return xs.length;
}

// Indexes an array it owns, so a caller can drive it out of bounds without
// needing to build an array itself.
export function readAt(i: number): number {
  const xs = [10, 20, 30];
  return xs[i]!;
}

// Array methods that need neither a growable representation nor a callback.
//
// `push`, `pop` and `splice` change the length, and the elements live inline
// after the header, so growing would move the object and every reference to it.
// `map`, `filter` and `forEach` take a function. Both are real extensions, and
// refusing beats guessing.
function digits(): number[] {
  return [3, 1, 4, 1, 5, 9, 2, 6];
}

// `indexOf` compares with `===`, so it never finds a NaN.
export function firstAt(x: number): number {
  return digits().indexOf(x);
}

export function lastAt(x: number): number {
  return digits().lastIndexOf(x);
}

// `includes` uses SameValueZero, which *does* find a NaN. That one difference
// is the thing an implementation is most likely to get wrong.
export function holds(x: number): boolean {
  return digits().includes(x);
}

// Negative counts from the end, and out of range is `undefined`.
export function nth(i: number): number {
  return digits().at(i)!;
}

export function filledWith(v: number): number {
  return digits().fill(v)[0]!;
}

export function reversedHead(): number {
  return digits().reverse()[0]!;
}

export function slicedLength(from: number, to: number): number {
  return digits().slice(from, to).length;
}
