// backend: wasm
// run: check
//
// **A tuple of unlike references on Wasm.** `[string, Point]` is two
// references, so `tuple_representation` makes it an array of its first
// element's type, `managed<[managed<str>]>`: right for C, where an element is
// a pointer whatever it points at, and for the JVM, where every reference
// array holds `Object`. Wasm types an array's element, and a `Point` is no
// string, so storing one declines ("no Wasm cast relates their storage") and
// so does reading one back. `struct` is the control, one difference: a number
// in the first slot makes the tuple a struct of a double and a reference,
// which Wasm lays out field by field. The cause is the representation core
// chooses, not the Wasm backend's casts; found by the Wasm lane collecting a
// `Map`'s entries (2026-10-21).

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
