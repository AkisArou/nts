// `String.fromCodePoint(k)` with a code point the guard accepts, in a loop.
//
// The sibling of `repeat-guard`, and for the same reason. The check the
// language specifies -- throw unless the argument is an integer in
// `[0, 0x10FFFF]` -- is emitted at the call, because a `RangeError` is laid out
// by the program and the C helper has nothing to allocate. Three comparisons
// and a branch, and the error is built only on the path that throws.
//
// What that leaves countable is whether the *message* is built eagerly. Node's
// reads `Invalid code point 1.5`, so the compiler has to concatenate the value
// into it, and a lowering that did the concatenation before the branch would
// allocate one string per call, throw or not, and still agree with node on
// every case. Nothing in the differential can see an allocation that changes
// no answer.
export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    total = (total + String.fromCodePoint(65 + i).length) | 0;
  }
  return total;
}
