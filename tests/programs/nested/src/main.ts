
// An explicit type annotation is a *child* of the declaration, so a
// declaration with one has three children where a declaration without has two.
// Reading them positionally refused every annotated local -- which is most of
// them in code that was written to be read.
export function annotated(n: number): number {
  const scale: number = 3;
  let count: number = 0;
  count = count + scale;
  return n * count;
}
