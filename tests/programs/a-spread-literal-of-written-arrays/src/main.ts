// An array literal with a spread in it, `[["s", t], ...more]`, whose written
// elements are arrays themselves. Each written element is lowered expecting
// the element type, as in a literal without a spread; lowered bare, the inner
// literal took the outer one's expected type, so `["s", t]` was built as an
// array of string arrays with strings stored in it. A native backend sees one
// pointer either way; Wasm's typed arrays refused it. `written` is the
// control, one difference: the same elements with no spread.

function more(n: number): string[][] {
  return [["a", "x" + n], ["b", "y"]];
}

function show(rows: string[][]): string {
  return rows.map((row) => row.join("")).join(",");
}

/** Inferred: the literal's own type is `string[][]`. */
export function inferred(n: number): string {
  const rows = [["s", "t" + n], ...more(n), ["z"]];
  return show(rows) + "|" + rows.length;
}

/** Annotated: the binding says `string[][]`. */
export function annotated(n: number): string {
  const rows: string[][] = [["s", "t" + n], ...more(n)];
  return show(rows);
}

/** Numbers inside, so the inner element is a double. */
export function numbers(n: number): number {
  const rows = [[n, n + 1], ...[[2, 3]], [4]];
  return rows[0][1] * 100 + rows[1][0] * 10 + rows[2][0];
}

/** The control: the same written elements, no spread. */
export function written(n: number): string {
  const rows = [["s", "t" + n], ["a", "x" + n], ["b", "y"], ["z"]];
  return show(rows) + "|" + rows.length;
}
