// run: check
// backend: jvm

// Control for a-radix-that-wraps-under-toint32-makes-parseint-nan: the same strings with the radices ToInt32 gives, 16, 2 and 0.
export function probe(r: number): number {
  return parseInt("10", 16) + r;
}
