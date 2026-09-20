// Reading an element of an array that `map` produced.
//
//     const xs: string[] = ["a", "b"];
//     const ys = xs.map((s) => s + "!");
//     ys[0]
//
// Correct on C, LLVM and the JVM, and **freed memory under reference
// counting** until 2026-09-20.
//
// # The cause
//
// `map` allocates its result with `nts_array_new_uninitialized`, and
// `rc::load_slot` was reading each slot *before* writing it, so that it could
// release whatever the slot held. Nothing held anything: the slots had never
// been written, so `nts_release` was handed whatever the allocator last left
// there and decremented a header belonging to something else.
//
// The runtime says the invariant in its own words — `nts_array_new_uninitialized`
// exists because "every slot is written", and `NTS_POISON` fills the storage
// with `0xA5` precisely so that a slot nobody wrote stops reading as zero. This
// pass made that false in the one build where the slots are pointers.
//
// **It looked benign for a long time**, and the same runtime comment says why:
// a *fresh* page is zero and `nts_release(NULL)` returns, which is exactly the
// measurement recorded there. A reused allocation is not zero.
//
// The store no longer reads a slot it can see was never written. The test is
// syntactic — the array operand is *directly* the `ArrayNew` — rather than a
// claim about every path that could reach one: where an uninitialised array is
// filled somewhere the pass cannot see, the release comes back and is as
// correct as it was.
//
// # How far the fix reaches, measured
//
// Thirteen shapes were swept under `rc` — a read of an element produced by
// `map`, `filter`, `slice`, `concat`, a spread, `toReversed`, `toSorted`,
// `Object.keys` and `Object.entries`, plus nested and chained maps. **Three
// were broken and are fixed**: `map`, a map producing arrays, and a map of a
// map. The other ten always passed.
//
// That was measured by removing the guard and re-running the sweep, not
// inferred from the cause. "Every operation that allocates its result
// uninitialised" would have been the tidy claim and it is not what the
// evidence says.
//
// # Why it looked like three unrelated bugs
//
// It is **data-dependent** — what the allocator last left in that memory — so
// each spelling failed a different number of the differential's cases, and
// shapes that differed only in allocation order looked like different bugs.
// `ys.join(",")` and `ys.length` pass because they read the storage inside the
// runtime rather than handing an element back, which made "how the result is
// read" look causal when it was a symptom.
//
// This fixture was first named `a-mapped-tuple-in-a-concatenation`, after a
// boundary that said the defect needed two or more elements, a number
// conversion and a **tuple** element. All three were measured and all three
// were wrong, because every comparison changed more than one thing at a time.
// The arms below are kept in both shapes — the small one and the original —
// because between them they are what finally located it.

const words: string[] = ["a", "b"];

/** The smallest failing program. */
export function anElementOfAMappedArray(n: number): string {
  const ys = words.map((s) => s + "!");
  return ys[0] + (n < 1 ? "" : "?");
}

/** A walk over the same array, which fails the same way. */
export function walkedInstead(n: number): string {
  const ys = words.map((s) => s + "!");
  let out = "";
  for (const y of ys) {
    out = out + y;
  }
  return out + (n < 1 ? "" : "?");
}

/** `join` reads the storage in the runtime, and passes. */
export function joinedInstead(n: number): string {
  const ys = words.map((s) => s + "!");
  return ys.join(",") + (n < 1 ? "" : "?");
}

/** So does the length, which reads no element at all. */
export function lengthOnly(n: number): number {
  const ys = words.map((s) => s + "!");
  return ys.length + (n < 1 ? 0 : 0);
}

/** A callback that produces no new string passes, element read and all. */
export function anIdentityMap(n: number): string {
  const ys = words.map((s) => s);
  return ys[0] + (n < 1 ? "" : "?");
}

/** And an element of an array that was written out, which is the other control. */
export function aLiteralArray(n: number): string {
  return words[0] + (n < 1 ? "" : "?");
}

const pairs: [string, number][] = [
  ["a", 1],
  ["b", 2],
];

/**
 * The shape this fixture started from. It ends in `join`, which the small
 * shape above passes — so it is a second failing combination, and any
 * explanation has to cover both.
 */
export function mappedTupleInAConcatenation(n: number): string {
  return pairs.map((e) => e[0] + "=" + e[1].toString()).join(",") + (n < 1 ? "" : "?");
}

/** The same work as a walk, which passes — so it is `map`, not the expression. */
export function theSameWorkInALoop(n: number): string {
  let out = "";
  for (const e of pairs) {
    out = out + e[0] + "=" + e[1].toString() + ";";
  }
  return out + (n < 1 ? "" : "?");
}
