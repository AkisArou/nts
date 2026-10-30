// expect: an array of Managed(Array(Float { bits: 64 })) where an array of Erased is wanted -- the two hold different widths, so a pointer to one is not a pointer to the other is not supported by this lowering yet
// A2: Bun's covariant-array route, adapted to a scalar differential entry.
// Source: bun 3a9ea00437f8065cd5a4604d7423299a769e2d9e,
// test/aot/parallel/mistyped-values/covariant-array.ts (MIT).
// Control changes only the widened alias to an independent array.
export function work(n: number): number {
  const rows: number[][] = [[1, 2, 3]];
  const wider: (number[] | string)[] = rows;
  if (n === 1) wider.push("abcde");
  function last(t: number[][]): number {
    try {
      return t[t.length - 1].length;
    } catch {
      return -1;
    }
  }
  return last(rows);
}
