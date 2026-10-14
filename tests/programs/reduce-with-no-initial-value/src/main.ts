// `xs.reduce(f)` with no initial value.
//
// Refused, and the refusal said exactly what it would take: *"`reduce` with no
// initial value starts from the first element and throws on an empty array,
// which is a different lowering and a different failure."*
//
// **It is the same loop started one along.** The specification takes the first
// element as the accumulator and walks from the second, and raises where there
// is no first. So the three differences from the seeded form are a guard, a seed
// read out of the array, and an index that begins at one — and everything else
// is shared, which is why it is a branch inside the existing loop rather than a
// second one beside it.
//
// The seed is read with the same `ArrayGet` the body reads every other element
// with, so the accumulator's first value and its later ones cannot disagree
// about what an element is.
//
// The raise is *observable* — `try { xs.reduce(f) } catch` catches it — and it
// is emitted by the lowering rather than left to the runtime, for the reason
// `guard_repeat_count` gives: a handler is a block and a `throw` is a jump this
// lowering writes, so nothing below it can reach one.

export function noSeed(n: number): number {
  return [1, 2, 3, n].reduce((a, b) => a + b);
}

/** The seeded form, which always worked and must keep working. */
export function withSeed(n: number): number {
  return [1, 2, 3, n].reduce((a, b) => a + b, 100);
}

/** One element: the accumulator is that element and the callback never runs. */
export function oneElement(n: number): number {
  return [n].reduce((a, b) => a + b);
}

/** A non-commutative callback, so the *order* is checked and not just the sum.
 *  A loop that folded the first element twice, or walked from zero, agrees with
 *  node on `noSeed` and fails here. */
export function nonCommutative(n: number): number {
  return [1, 2, 3].reduce((a, b) => a * 10 + b) + n;
}

/** Elements that are not numbers. */
export function strings(n: number): string {
  return ["a", "b", "c"].reduce((a, b) => a + b) + n.toString();
}

/** The empty array raises, and the message is node's word for word. */
export function emptyThrows(n: number): number {
  const xs: number[] = [];
  try {
    return xs.reduce((a, b) => a + b);
  } catch (e) {
    return e instanceof TypeError ? 1 : 2;
  }
}

/** Empty *with* a seed does not raise — it is the seed. The two halves of the
 *  guard's condition, one line apart. */
export function emptyWithSeed(n: number): number {
  const xs: number[] = [];
  return xs.reduce((a, b) => a + b, n);
}
