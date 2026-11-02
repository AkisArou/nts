// run: check
// backend: jvm

// Control for a-unicode-space-before-a-number-makes-parseint-nan: the same strings with an ASCII space in each place.
export function probe(x: number): number {
  return parseInt(" 7", 10) + x;
}
