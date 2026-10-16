// A face of fields read and written through it in a hot loop, held three ways:
// by a class whose fields begin with the face's, by one that keeps them in
// another order, and by a literal of the face itself.
//
// Structural typing is the whole of the shape. Nothing here says `implements`,
// and C reads each field out of whichever struct arrives at the face's offset,
// or through the family row of the class that moved it. A JVM class has no
// offsets, so on that lane the face is *split* (`codegen/jvm/src/split_faces.rs`):
// a value of it is referred to as an interface every holder implements, and a
// read through it is an accessor call -- the family's row or default, or the
// field's own accessor. Three receivers, so the call site is not bimorphic:
// the case a JIT's profile does not hand over for free.
//
// `int` fields and `int` arithmetic, as in `upcast`: the masks prove an i32.

interface Point {
  x: number;
  y: number;
}

class Flat {
  x: number;
  y: number;
  z = 0;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Swapped {
  tag = 1;
  y: number;
  x: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function weigh(p: Point): number {
  return (p.x * 3 + p.y) | 0;
}

export function work(seed: number): number {
  const step = seed | 0;
  const points: Point[] = [new Flat(step, 1), new Swapped(2, step), { x: 3, y: step }];
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const p = points[i % 3]!;
    p.x = (p.x + i) & 0xffff;
    total = (total ^ weigh(p)) | 0;
  }
  return total;
}

/**
 * The input the harness calls `work` with; see `upcast`.
 */
export const seed = 5;

// The representation this row measures (`nts expect-ir`): `x` and `y` are
// read through `Point` by testing for `Swapped`, the one class that moves
// them, and reading every other holder where `Point` holds them -- no
// dispatch table on the path (`hir::small_dispatch`).
// expect-ir: all: no call.virtual in work
// expect-ir: all: no call.virtual in weigh
