// **A tuple of references read at a later slot.** `[string, Point]` is two
// references of different types. It was an array of its *first* element's
// type, `managed<[managed<str>]>`, so a read of slot 1 was a string converted
// to `Point`, which C's emitter declined (NTS2006) and Wasm could not cast.
// Now an array of erased values: each slot holds what it holds, and a read
// unerases to the slot's type. Found by the Wasm lane collecting a `Map`'s
// entries (2026-10-21), whose `Map<string, Point>` pairs are this tuple.

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
  for (const pair of pairs) sum += pair[1].x;
  return sum;
}
