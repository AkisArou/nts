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
