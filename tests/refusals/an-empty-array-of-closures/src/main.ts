// expect: emits-c collected
//
// **Landed 2026-09-17, and the guard is turned around rather than deleted.** It
// was `lacks-c collected`, with a line saying "when this lands, the function
// appears and the guard fails, which is what a guard is for". It did, and it
// did. `emits-c` is the same assertion from the other side: this fixture now
// says the function is emitted, so a regression removes it again and this says
// so.
//
// The fix was one line and not in the representation family this file guessed
// at. `lower_empty_array` takes its type from the annotation and nothing else
// mentions it, so the element type was never materialised — a non-empty literal
// works because its elements are materialised on the way in, and the same array
// as a *parameter* works because parameters are too. An empty literal is the
// one position where the type is written down and nothing walks it.
//
// **The 61 occurrences across 36 locations below did not move, and that is the
// honest measurement.** Re-run after the fix: 475 occurrences, 35 distinct,
// unchanged. Those sites are a different shape wearing the same diagnostic — a
// generic over a rest tuple, `once<A extends unknown[]>(fn: (...args: A) =>
// void)`, which refuses as ``A`, captured above its own declaration`. The
// paragraph below was right that `Fifo<T>` is "this fixture's problem one level
// of generality up"; it was wrong that closing this would reach it.
//
// `const fs: (() => number)[] = []` and then `fs.push(() => n)` — a list of
// callbacks, which is how any program collects listeners.
//
// **An array *literal* of closures works.** `[() => n, () => n * 2]` takes its
// element type from the arrows themselves, and each arrow is a class; two of one
// shape merge. An *empty* array has no elements to take it from, so it takes the
// annotation's — a bare function type, which has no layout, because a function
// type has no fields and two closures of one type differ by what they captured.
//
// So this is the representation family rather than a missing case: an array of
// closures needs one representation for a closure of a given signature, and the
// pieces for that exist (`Callee::Closure`, the `Fn…__…` signature layouts)
// without being what an annotation resolves to.
//
// It arrives as `NTS2006` from the C backend rather than as a refusal from the
// lowering, and that is why the guard is `lacks-c` rather than an `expect:` of a
// refusal: the lowering reports "3 function(s), nothing refused", `emit-c`
// prints the `NTS2006` and **still writes the file**, and the observable is that
// `collected` is not in it. When this lands, the function appears and the guard
// fails, which is what a guard is for.
//
// That gap between what the lowering says and what the backend does is the same
// shape measured at scale: **61 occurrences across
// 36 distinct locations** in `runtime/node` on 2026-09-17, the largest cluster
// being `Fifo<T>` in `web-platform/src/streams/fifo.ts` — a generic container
// instantiated at an element type with no layout, which is this fixture's
// problem one level of generality up.

export function collected(n: number): number {
  const fs: (() => number)[] = [];
  fs.push(() => n);
  fs.push(() => n * 2);
  return fs[0]() + fs[1]();
}
