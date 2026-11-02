// run: check
// backend: jvm

// Control for a-capturing-to-string-skipped-by-string-conversion: the same conversion of a toString() that captures nothing.
export function probe(n: number): number {
  const shown = { toString(): string { return "own"; } };
  return String(shown) + String(n) === "own" + String(n) ? 1 : 0;
}
