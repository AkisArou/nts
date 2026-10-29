// run: check
// sanitizer: address
// A local array supplies its actual length. An unchecked declared literal-union
// range used to remove the bounds check as well as truncate fractional inputs.
// The control changes only the argument to a choice of in-range literals:
// tests/programs/a-local-array-index-proved-by-literal-callers.
function pick(d: 0 | 1 | 2 | 3): number {
  const table = [10, 20, 30, 40];
  return table[d] ?? -1;
}
export function viaCastIndex(x: number): number { return pick(x as 0 | 1 | 2 | 3); }
