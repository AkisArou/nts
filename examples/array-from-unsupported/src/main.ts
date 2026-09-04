// The `Array.from` forms this compiler refuses, which are the two-argument one
// wearing one name over two features.

// With an iterable, the second argument is `map` fused into the walk -- which
// is what the callback machinery does for `xs.map(f)`, and would have to do
// here rather than allocating the intermediate array `Array.from(xs).map(f)`
// would.
export function withAMapper(n: number): number {
  const xs = Array.from([1, 2, 3], (v) => v * n);
  return xs[2];
}

// With `{ length: n }` it is not an iteration at all. An **array-like** is read
// by index, and `Array.from({ length: 4 })` builds four `undefined`s out of an
// object that has no elements to walk.
export function overAnArrayLike(n: number): number {
  const xs = Array.from({ length: 3 }, (_, i) => i + n);
  return xs[1];
}
