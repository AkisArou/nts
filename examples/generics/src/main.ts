// A generic function is lowered once per instantiation and not at all as
// itself: a parameter of type `T` has no width. The instantiations come from
// the *calls*, because that is where the checker puts them -- it hands back an
// instantiated signature per call site, and only the body still says `T`.
//
// So `first` below becomes `first<f64>` and `first<str>`, and each call names
// the copy made for it.

import { pick as fromHelpers } from "./helpers.js";

function first<T>(xs: T[]): T {
  return xs[0]!;
}

function last<T>(xs: T[]): T {
  return xs[xs.length - 1]!;
}

// Two type parameters, and one of them appears twice.
function middleOf<T>(xs: T[], fallback: T): T {
  return xs.length > 0 ? xs[0]! : fallback;
}

// Declared here *and* in helpers.ts. Both are emitted, under different names.
function pick(a: number, b: number): number {
  return a < b ? a : b;
}

export function numbers(seed: number): number {
  const xs = [seed, seed + 1, seed + 2];
  return first(xs) * 100 + last(xs);
}

// The same generic at a different instantiation: a second copy, not a cast.
export function strings(): number {
  const xs = ["ab", "cde", "f"];
  return first(xs).length * 100 + last(xs).length;
}

export function withFallback(seed: number): number {
  const xs: number[] = [];
  return middleOf(xs, seed);
}

export function bothPicks(a: number, b: number): number {
  return pick(a, b) * 1000 + fromHelpers(a, b);
}
