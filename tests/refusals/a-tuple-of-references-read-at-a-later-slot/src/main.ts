// expect: emit-c -> NTS2006 an object type needs the program to be named
//
// **A tuple of references read at a later slot.** `[string, Point]` is two
// references, so `tuple_representation` makes it an array of its first
// element's type -- `managed<[managed<str>]>` -- and a read of slot 1 is the
// string array's element converted to `Point`. The C emitter spells that
// conversion's target with `c_type`, the fixed names, which has no spelling
// for a program's object type, and declines the function: NTS2006, which
// `nts check` on every backend reports, because each checks against C.
// The `FieldView` arm beside it spells its target with `c_type_of`, which
// takes the program, and doing the same here compiles it and agrees with
// node on C, LLVM and the JVM. Found by the Wasm lane collecting a `Map`'s
// entries (2026-10-21), whose `Map<string, Point>` pairs are exactly this.
//
// Control, one difference -- the object in the first slot, which is the
// array's own element type, so no slot is converted:
//
//     export function total(n: number): number {
//       const pairs: [Point, string][] = [];
//       for (let i = 0; i < 4; i++) pairs.push([new Point(i * n), "p" + i]);
//       let sum = 0;
//       for (const pair of pairs) sum += pair[0].x;
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
  for (const pair of pairs) sum += pair[1].x;
  return sum;
}
