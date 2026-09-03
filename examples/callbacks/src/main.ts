// `forEach`, `map` and `reduce` with an inline arrow, each compiled as the loop
// it is: no closure allocated, no indirect call, and the callback's body
// inlined into the caller.
//
// The three differ in exactly one thing -- what happens to the value the body
// produces. It is dropped, stored at the same index of a new array, or carried
// to the next iteration. Everything else is shared, which is why a `return`
// inside a block body behaves the same in all three.
//
// This file exists because the feature shipped without one. `forEach` was
// documented as done and no example drove it, so the differential had nothing
// to say about it -- and a `return` inside the callback was emitting `return;`
// in the middle of a function with a result, which is C that clang rejects,
// from a lowering that reported nothing refused.

function digits(seed: number): number[] {
  return [seed, -seed, 3, -4, 5, 0];
}

// The plain shape, and the one that already worked.
export function total(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => {
    sum = sum + v * 2;
  });
  return sum;
}

// A concise body: an expression rather than a block, so it cannot contain a
// `return` at all.
export function concise(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => (sum = sum + v));
  return sum;
}

// `return` means "this element is done", which is the loop's `continue` -- not
// "this function is done". Lowering it as an ordinary return is what produced
// the uncompilable C, and stepping the index at the end of the *body* rather
// than in a latch is what made the first fix loop forever: the jump skipped
// the step.
export function skipNegatives(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => {
    if (v < 0) {
      return;
    }
    sum = sum + v;
  });
  return sum;
}

// `return e` against a callback declared to return `void`, which TypeScript
// allows. The value is lowered for its effects and dropped.
export function returnsAValue(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => {
    if (v > 2) {
      return v;
    }
    sum = sum + v;
  });
  return sum;
}

// The jump crosses a loop the source did write, so it leaves two constructs at
// once and lands on the synthesized latch rather than the inner one.
export function throughAnInnerLoop(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => {
    for (let i = 0; i < 3; i++) {
      if (v === 3) {
        return;
      }
      sum = sum + i;
    }
    sum = sum + v;
  });
  return sum;
}

// Two of them one after the other, so the second loop's latch is not the
// first's -- a target stack that failed to pop would send it to the wrong one.
export function twice(seed: number): number {
  let sum = 0;
  digits(seed).forEach((v) => {
    if (v < 0) {
      return;
    }
    sum = sum + v;
  });
  digits(seed).forEach((v) => {
    if (v > 0) {
      return;
    }
    sum = sum * 2 + v;
  });
  return sum;
}

// Nested: the inner `forEach` pushes a second target over the first, and a
// `return` in the inner body must end the inner iteration.
export function nested(seed: number): number {
  let sum = 0;
  digits(seed).forEach((outer) => {
    if (outer < 0) {
      return;
    }
    digits(seed).forEach((inner) => {
      if (inner < 0) {
        return;
      }
      sum = sum + outer * inner;
    });
    sum = sum + 1;
  });
  return sum;
}

// `map`, which is the same loop with the body's value stored rather than
// dropped. The result array is allocated once before the loop, at the length
// the receiver already has -- nothing grows.
export function doubled(seed: number): number {
  const ys = digits(seed).map((v) => v * 2);
  return ys.reduce((acc, v) => acc + v, 0);
}

// `reduce`, which is the same loop with the body's value carried. The
// accumulator is a loop-carried name like any other, so no allocation and no
// escape.
export function summed(seed: number): number {
  return digits(seed).reduce((acc, v) => acc + v, 100);
}

// A block body, where the value arrives through a `return` -- which has to
// deliver it *before* it jumps to the latch. Two returns, so both paths do.
export function squaresOfPositives(seed: number): number {
  return digits(seed).reduce((acc, v) => {
    if (v < 0) {
      return acc;
    }
    return acc + v * v;
  }, 0);
}

// The same for `map`, where delivering means a store rather than a rebind.
export function clamped(seed: number): number {
  const ys = digits(seed).map((v) => {
    if (v < 0) {
      return 0;
    }
    return v + 1;
  });
  return ys.reduce((acc, v) => acc + v, 0);
}

// The element type changes: `number[]` in, `boolean[]` out.
export function signs(seed: number): number {
  const flags = digits(seed).map((v) => v > 0);
  let count = 0;
  flags.forEach((f) => {
    if (f) {
      count = count + 1;
    }
  });
  return count;
}

// Chained, so each `map` reads the array the previous one allocated.
export function chained(seed: number): number {
  return digits(seed)
    .map((v) => v * 2)
    .map((v) => v + 1)
    .reduce((acc, v) => acc + v, 0);
}

// The callback assigns a name from outside it, which the loop carries the way
// it carries any other -- this is the shape a closure could not have compiled,
// because capture here is by value and JavaScript's is by reference.
export function counted(seed: number): number {
  let seen = 0;
  const ys = digits(seed).map((v) => {
    seen = seen + 1;
    return v * seen;
  });
  return ys.reduce((acc, v) => acc + v, seen);
}

// An empty receiver: the body never runs, `map` gives an empty array and
// `reduce` gives back the seed it was handed.
export function overNothing(seed: number): number {
  const none: number[] = [];
  const ys = none.map((v) => v * 2);
  return ys.reduce((acc, v) => acc + v, seed);
}

// A `reduce` whose accumulator is not the element type, and a `map` inside it.
export function nestedIteration(seed: number): number {
  return digits(seed).reduce((acc, v) => {
    const inner = digits(v).map((w) => w + 1);
    return acc + inner.reduce((a, w) => a + w, 0);
  }, 0);
}

// `some` and `every`, which are the same loop with different stopping
// conditions -- and the first two of these that can end before the last
// element. The answer is loop-carried like `reduce`'s accumulator, so nothing
// is allocated for it, and the early exit leaves through the block `break`
// leaves through.
export function anyNegative(seed: number): boolean {
  return digits(seed).some((v) => v < 0);
}

export function allSmall(seed: number): boolean {
  return digits(seed).every((v) => v < 100);
}

// Neither ever decides, so both run to the end and answer with their seed.
export function noneHuge(seed: number): boolean {
  return digits(seed).some((v) => v > 1000);
}

export function notAllPositive(seed: number): boolean {
  return digits(seed).every((v) => v > 0);
}

// An empty array, where the seed *is* the answer: `[].some(f)` is `false` and
// `[].every(f)` is `true`, and the callback never runs.
export function emptySome(seed: number): boolean {
  const none: number[] = [];
  return none.some((v) => v === seed);
}

export function emptyEvery(seed: number): boolean {
  const none: number[] = [];
  return none.every((v) => v === seed);
}

// The stop is observable. A counter incremented in the callback says how many
// elements were looked at, and `some` that stops at the first `true` looks at
// fewer than the whole array -- which is the difference between this and a
// `filter(...).length > 0`.
export function stopsEarly(seed: number): number {
  let seen = 0;
  const found = digits(seed).some((v) => {
    seen = seen + 1;
    return v === 3;
  });
  return seen * 10 + (found ? 1 : 0);
}

export function everyStopsEarly(seed: number): number {
  let seen = 0;
  const all = digits(seed).every((v) => {
    seen = seen + 1;
    return v >= 0;
  });
  return seen * 10 + (all ? 1 : 0);
}

// A block body with a `return`, which delivers through the same path a concise
// body does.
export function blockBodied(seed: number): boolean {
  return digits(seed).some((v) => {
    const doubled = v * 2;
    return doubled === 6;
  });
}

// In a condition, which is where a predicate usually appears.
export function usedInAnIf(seed: number): number {
  if (digits(seed).some((v) => v === 5)) {
    return 100;
  }
  return 200;
}

// Both over the same array, and a `some` inside an `every`'s callback: the
// inner loop has a carried answer of its own and must not disturb the outer.
export function nestedPredicates(seed: number): boolean {
  const outer = [1, 2, 3];
  return outer.every((a) => digits(seed).some((b) => b === a));
}

// `findIndex`, which is `some` carrying the index it stopped at instead of the
// answer that stopped it. `-1` is the seed and the answer for an array that
// never decides, so nothing beside it records whether anything was found.
export function whereIsThree(seed: number): number {
  return digits(seed).findIndex((v) => v === 3);
}

export function whereIsNothing(seed: number): number {
  return digits(seed).findIndex((v) => v === 100000);
}

// The first match wins, and the array has two elements that satisfy this.
export function firstNonNegative(seed: number): number {
  return [-1, -2, seed * 0 + 4, 5].findIndex((v) => v >= 0);
}

export function findIndexEmpty(seed: number): number {
  const none: number[] = [];
  return none.findIndex((v) => v === seed);
}

// Stops where it finds, which is observable through a counter.
export function findIndexStops(seed: number): number {
  let seen = 0;
  const at = digits(seed).findIndex((v) => {
    seen = seen + 1;
    return v === -4;
  });
  return seen * 100 + at;
}

// `filter`, which is the first of these whose result is shorter than its input
// and so the first that has to decide how much to allocate.
//
// One allocation: as long as the input, filled from the front, and shortened
// to what was kept. Growing with `push` is the other way to write it and pays a
// block every time it doubles.
export function positives(seed: number): number {
  const kept = digits(seed).filter((v) => v > 0);
  let sum = 0;
  for (const v of kept) {
    sum = sum + v;
  }
  return sum * 10 + kept.length;
}

// Keeps everything, so the result is exactly as long as the allocation.
export function keepsAll(seed: number): number {
  return digits(seed).filter((v) => v === v).length;
}

// Keeps nothing, which is the shortening at its largest.
export function keepsNone(seed: number): number {
  return digits(seed).filter((v) => v === 999999).length;
}

export function filterEmpty(seed: number): number {
  const none: number[] = [];
  return none.filter((v) => v === seed).length;
}

// A block body, and a predicate that is not already a boolean.
export function filterBlock(seed: number): number {
  const kept = digits(seed).filter((v) => {
    const doubled = v * 2;
    return doubled > 0;
  });
  return kept.length;
}

// Elements that are references, which is the case the zeroed allocation is for:
// the array is live while the callback runs, and its tail must not be read as
// pointers the loop never wrote.
export function filterStrings(seed: number): string {
  const names = ["alpha", "b", "gamma", "d", "epsilon"];
  const long = names.filter((s) => s.length > 1 + (seed - seed));
  return long.join(",") + ":" + String(long.length);
}

// Chained, which is where the shortened length has to be right for the next
// method to see it.
export function filterThenMap(seed: number): number {
  const out = digits(seed)
    .filter((v) => v >= 0)
    .map((v) => v * 3);
  let sum = 0;
  for (const v of out) {
    sum = sum + v;
  }
  return sum;
}

// And the predicates over the shortened result, which must not see the tail.
export function filterThenSome(seed: number): number {
  const kept = digits(seed).filter((v) => v > 0);
  return (kept.some((v) => v === 0) ? 1 : 0) + (kept.every((v) => v > 0) ? 2 : 0);
}

// `find`, which is `findIndex` reading the element out at the end.
//
// The seed is the *length* rather than `-1`: both say "nothing matched", and
// `at` already answers `undefined` for an index that is not there -- so the
// result is one helper call rather than a conditional built here.
export function firstNegative(seed: number): number {
  return digits(seed).find((v) => v < 0) ?? 999;
}

export function findsNothing(seed: number): number {
  return digits(seed).find((v) => v === 100000) ?? -7;
}

export function findEmpty(seed: number): number {
  const none: number[] = [];
  return none.find((v) => v === seed) ?? 42;
}

// The first match wins where several would do.
export function firstOdd(seed: number): number {
  return [2, 4, seed * 0 + 5, 7, 8].find((v) => v % 2 === 1) ?? 0;
}

// Stops where it finds, which a counter makes visible.
export function findStops(seed: number): number {
  let seen = 0;
  const found = digits(seed).find((v) => {
    seen = seen + 1;
    return v === 3;
  });
  return seen * 100 + (found ?? 0);
}

// A reference element, where the result is a nullable pointer rather than a
// tagged value.
export function findsAName(seed: number): string {
  const names = ["alpha", "bb", "gamma"];
  const long = names.find((s) => s.length > 2 + (seed - seed));
  return long ?? "none";
}
