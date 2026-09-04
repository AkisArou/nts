// `Array.from` over a table, which is the shape with no run of memory to copy.
//
// One array comes out and it is the answer, so it cannot be zero. What the
// case is about is how *many* arrays were built to arrive at one.

export function work(n: number): number {
  const marks = new Set<number>();
  for (let i = 0; i < 16 + n; i++) {
    marks.add(i * 3);
  }
  const listed = Array.from(marks);
  return listed.length;
}
