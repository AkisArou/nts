// expect: lacks-c collected
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
