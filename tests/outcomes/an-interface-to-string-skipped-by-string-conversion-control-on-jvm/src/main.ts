// run: check
// backend: jvm

// Control for an-interface-to-string-skipped-by-string-conversion: the same object typed by its own literal type.
export function probe(n: number): number {
  const shown = { toString(): string { return "own"; } };
  return String(shown) === "own" ? 1 : 0;
}
