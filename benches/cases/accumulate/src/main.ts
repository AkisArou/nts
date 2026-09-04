// An accumulator in a counted loop. The counter is bounded by a constant and
// each increment is bounded by a mask, so the total is bounded too -- but only
// if something counts the iterations. Interval analysis alone sends it to
// infinity, and an infinite bound is not a whole number, so the accumulator
// stays a double and the C compiler may not reassociate it.
//
// It depends on `seed`, so none of this folds away at compile time.
export function accumulate(seed: number): number {
  let h = seed | 0;
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    h = (h * 31 + i) | 0;
    total += h & 255;
  }
  return total;
}
