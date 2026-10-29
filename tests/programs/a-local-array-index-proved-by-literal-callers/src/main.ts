// The same parameter and local array, reached only from in-range literal values.
function pick(d: 0 | 1 | 2 | 3): number {
  const table = [10, 20, 30, 40];
  return table[d] ?? -1;
}
export function viaCastIndex(x: number): number { return pick(x > 0 ? 1 : 0); }
