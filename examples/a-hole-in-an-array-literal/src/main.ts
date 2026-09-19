// An **elision in an array literal** — `[1, , 3]`, `[,]`, `[, , ,]`.
//
// Not the same production as a hole in a destructuring *pattern*
// (`const [, second] = pair`), which has worked since 2026-09-17 and has
// `examples/a-hole-in-a-destructuring-pattern`. The census report spent a
// paragraph establishing that the corpus's elision coverage was all the
// latter, and 18 files separate the two.
//
// # Why it was refused, and what changed
//
// A hole reads as `undefined`, and a `number[]` has no room for one — so
// storing anything there is a wrong answer rather than a missing feature. The
// refusal said exactly that: *"an array literal with a hole in it, which reads
// as `undefined` and so needs an element type with room for one"*.
//
// What was missing was the room. `undefined` and `void` both represent as
// `HirType::Void`, which is right for a function's result — it returns nothing
// — and wrong for a **slot that is read back**. `in_a_slot` is that
// distinction: at the two places a representation becomes a slot, an array's
// element and a tuple's position, a `Void` becomes `Erased`, the one
// representation with an `undefined` in it.
//
// A *numeric* placeholder would not do, and that is the difference from
// `suspend::yielded_slot` one construct over. There nothing can read the slot;
// here the value is read and compared with `undefined`:
//
//     method([x = 23] = [,]) { … }
//
// reads index 0 to decide whether the default fires. A `0` there would not
// fire it and `x` would be `0` where JavaScript says 23.
//
// # What this is not
//
// **A hole is absent, not present-and-`undefined`.** `1 in [1, , 3]` is
// `false`, `Object.keys` gives `["0", "2"]`, and `forEach`, `map` and `join`
// all skip it. This stores a value at that index, so every one of those would
// disagree with node — and each of them refuses today, which is measured
// rather than assumed.
// `tooling/conformance/blockers/a-hole-is-absent-not-undefined` pins those
// refusals, because a correct rule standing behind a guard nobody put there
// for it is how this goes wrong silently later.

const trailing = [1, , 3];

/** The hole reads as `undefined`. */
export function readsUndefined(n: number): number {
  return (trailing[1] === undefined ? 10 : 20) + n;
}

/** The elements around it are untouched, which a wrongly *placed* hole breaks. */
export function neighbours(n: number): number {
  return (trailing[0] ?? 0) * 10 + (trailing[2] ?? 0) + n;
}

/** A hole occupies a position, so the length counts it. */
export function lengthCountsIt(n: number): number {
  return trailing.length + n;
}

/** Several holes, and nothing else — the `[,]` the corpus writes. */
export function onlyHoles(n: number): number {
  const empty = [, , ,];
  return empty.length * 10 + (empty[1] === undefined ? 1 : 0) + n;
}

/**
 * The corpus's shape: a destructured parameter whose whole-parameter default is
 * an array literal with a hole. 36 files of the slice-1 `test/language`
 * population, which the census reported as *a parameter of unrepresentable type
 * (a tuple)* — the tuple being `[undefined]`, one cause under a message naming
 * another.
 */
class C {
  method([x = 23] = [,]): number {
    return x;
  }
}

export function aDefaultOverAHole(n: number): number {
  return new C().method() + n;
}

/**
 * The default is not the only path. A *separate* method, annotated, because
 * `method`'s parameter takes its type from `[,]` — which is `[undefined]`, so
 * `new C().method([7])` is `TS2322` before the compiler sees it. That is the
 * language being consistent rather than a limitation: a parameter whose only
 * stated type is a hole can hold nothing else.
 */
class D {
  method([x = 23]: (number | undefined)[] = [,]): number {
    return x;
  }
}

export function aValueOverTheDefault(n: number): number {
  return new D().method([7]) + n;
}

export function theDefaultOnD(n: number): number {
  return new D().method() + n;
}

/**
 * A **leading** hole, which a lowering that counted only the elements it wrote
 * would put in the wrong place.
 */
export function leading(n: number): number {
  const xs = [, 5];
  return (xs[0] === undefined ? 10 : 20) + (xs[1] ?? 0) + n;
}

/**
 * No hole at all, in the same file. The control: a change that gave every array
 * an erased element would pass every arm above and lose this one's `f64`
 * storage, which `emit-c` shows and no answer does.
 */
const dense: number[] = [4, 5, 6];

export function withoutAHole(n: number): number {
  return dense[1] + n;
}
