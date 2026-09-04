// What `String(x)` costs, which should be nothing.
//
// Unlike case conversion, the length of the answer is bounded before the call:
// a double's shortest round-tripping decimal needs at most seventeen
// significant digits, so the widest thing this can produce is twenty-four
// characters. A bound the compiler knows is a bound it can put in the frame.
//
// The result dies in the iteration that made it -- nothing stores it, nothing
// returns it -- so there is no reason for any of these to reach the allocator.

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    // A different value each time, so nothing here folds to a constant.
    const text = String(i * 1000 + n);
    total = total + text.length;
  }
  return total;
}
