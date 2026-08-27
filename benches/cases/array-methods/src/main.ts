// Array methods over a fixed array: a search, a membership test, an indexed
// read that counts from the end, and two in-place rewrites.
//
// It depends on `seed`, so none of it folds away at compile time.
export function work(seed: number): number {
  const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3];
  const step = seed | 0;
  let total = 0;
  for (let round = 0; round < 256; round++) {
    total = (total + xs.indexOf(step) + xs.lastIndexOf(step)) | 0;
    if (xs.includes(step)) {
      total = (total + 1) | 0;
    }
    total = (total + xs.at(-1)!) | 0;
    xs.reverse();
  }
  return total;
}
