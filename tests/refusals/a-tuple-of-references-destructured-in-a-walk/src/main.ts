// expect: `x`, where an array has only `length`
//
// **A tuple of references destructured by a walk.** `for (const [, p] of
// pairs)` over `[string, Point][]` refuses in lowering, on every backend:
// `[string, Point]` is two references, so `tuple_representation` makes it an
// array of its first element's type, and the pattern binds `p` as something
// whose `.x` reads as an array's member. The same tuple read at its slot,
// `pair[1].x`, lowers (a C emitter decline of its own:
// a-tuple-of-references-read-at-a-later-slot). Found by the Wasm lane
// collecting a `Map`'s entries (2026-10-21).
//
// Control, one difference -- a number in the first slot, so the tuple is a
// struct of a double and a reference rather than an array:
//
//     export function total(n: number): number {
//       const pairs: [number, Point][] = [];
//       for (let i = 0; i < 4; i++) pairs.push([i, new Point(i * n)]);
//       let sum = 0;
//       for (const [, p] of pairs) sum += p.x;
//       return sum;
//     }

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

export function total(n: number): number {
  const pairs: [string, Point][] = [];
  for (let i = 0; i < 4; i++) pairs.push(["p" + i, new Point(i * n)]);
  let sum = 0;
  for (const [, p] of pairs) sum += p.x;
  return sum;
}
