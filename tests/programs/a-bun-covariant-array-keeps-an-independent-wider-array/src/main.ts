// Control: only the widened alias becomes an independent array.
export function work(n: number): number {
  const rows: number[][] = [[1, 2, 3]];
  const wider: (number[] | string)[] = [[1, 2, 3]];
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
