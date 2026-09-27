// A *plain* `pick`. Declaring the name twice in one program is what makes the
// emitted names `pick@one` and `pick@two`; this half always compiled, because a
// declaration with a body is the one `qualified_names` records.

export function pick(n: number): number {
  return n * 3;
}
