// run: check
// backend: llvm

// Control for an-absent-record-key-compares-as-present: the same lookups with the value type declared `string | undefined`.
export function probe(n: number): number {
  const registry: Record<string, string | undefined> = {};
  const slot = "k" + String(n);
  if (registry[slot] === undefined) registry[slot] = "made";
  return registry[slot] === "made" ? 1 : 0;
}
