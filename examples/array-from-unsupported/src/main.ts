// The `Array.from` form this compiler refuses: the two-argument call wears one
// name over two features, and this is the half that is not an iteration.

// With an iterable, the second argument is `map` fused into the walk -- which
// is what the callback machinery does for `xs.map(f)`. **That half landed**;
// `examples/array-from-with-a-callback` is where it is measured, and this arm
// was still sitting here calling it unsupported while lowering and agreeing
// with node. Removed 2026-09-17, which is what this file's own rule asks for.

// With `{ length: n }` it is not an iteration at all. An **array-like** is read
// by index, and `Array.from({ length: 4 })` builds four `undefined`s out of an
// object that has no elements to walk.
export function overAnArrayLike(n: number): number {
  const xs = Array.from({ length: 3 }, (_, i) => i + n);
  return xs[1];
}
