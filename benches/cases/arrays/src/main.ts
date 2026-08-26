// Indexing in a counted loop, which is where the range analysis pays a second
// time: the same facts that make `i` an int32 prove it is inside the array, so
// the bounds test is removed rather than emitted.
//
// It depends on `seed`, so none of it folds away at compile time.
export function convolve(seed: number): number {
  const xs = [0, 37, 74, 10, 47, 84, 20, 57, 94, 30, 67, 3, 40, 77, 13, 50, 87, 23, 60, 97, 33, 70, 6, 43, 80, 16, 53, 90, 26, 63, 100, 36];
  let total = 0;
  for (let round = 0; round < 128; round++) {
    for (let i = 1; i < xs.length; i++) {
      total += xs[i]! * xs[i - 1]! + (seed | 0);
    }
  }
  return total;
}
