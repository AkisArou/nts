// A module-level array, read through two separate loads of the same global.
//
// `bounds::same_array` says two `GlobalGet` of one global are one array while
// nothing writes it, which is what lets the length in the loop condition bound
// the index in the body. It is committed and has never been measured, and this
// is the measurement.
//
// Nothing is allocated per call, so nothing is owed per call. Every operation
// this reports is the global being counted on the way in and out of a load that
// could not have dropped it.

const table: number[] = [3, 1, 4, 1, 5, 9, 2, 6];

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < table.length; i++) {
    total = total + table[i] * n;
  }
  return total;
}
