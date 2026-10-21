// **A tuple of unlike references on Wasm.** `[string, Point]` was an array of
// its first element's type, `managed<[managed<str>]>`: survivable on C, where
// an element is a pointer whatever it points at, and on the JVM, where a
// reference array holds `Object`, and impossible on Wasm, which types an
// array's element -- storing a `Point` declined ("no Wasm cast relates their
// storage"). Now an array of erased values. `struct` beside it is a tuple of
// a double and a reference, which was always a struct. Found by the Wasm lane
// collecting a `Map`'s entries (2026-10-21).

class Point {
  constructor(public x: number) {}
}

export function references(n: number): number {
  const pairs: [string, Point][] = [];
  for (let i = 0; i < 4; i++) pairs.push(["p" + i, new Point(i * n)]);
  return pairs.length;
}

export function struct(n: number): number {
  const pairs: [number, Point][] = [];
  for (let i = 0; i < 4; i++) pairs.push([i, new Point(i * n)]);
  return pairs.length;
}
