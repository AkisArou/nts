// A field read and written through an interface, over classes that lay it out
// differently, where only a few classes move the field: the dispatch is a test
// for each of those and a positional read for the rest (`hir::small_dispatch`).
// Every way a class can hold the field is here -- where the face does, moved,
// and behind an accessor whose row runs code -- and a literal of the face.
// Its control is `a-field-through-a-face-too-many-classes-move`: one more
// class that moves the field, past what the tests are for, so it keeps the
// table, and must answer the same.

interface Point {
  x: number;
  y: number;
}

// Where `Point` holds them: a prefix, read positionally.
class Flat {
  x: number;
  y: number;
  z = 0;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// Moved: `x` is third.
class Swapped {
  tag = 1;
  y: number;
  x: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// Behind an accessor: the row has to run the getter and the setter.
class Doubled {
  stored = 0;
  y: number;
  constructor(x: number, y: number) {
    this.stored = x * 2;
    this.y = y;
  }
  get x(): number {
    return this.stored / 2;
  }
  set x(value: number) {
    this.stored = value * 2;
  }
}

function weigh(p: Point): number {
  return (p.x * 3 + p.y) | 0;
}

function bump(p: Point, by: number): void {
  p.x = (p.x + by) & 0xffff;
}

export function reads(seed: number): number {
  const step = seed | 0;
  const points: Point[] = [new Flat(step, 1), new Swapped(2, step), { x: 3, y: step }, new Doubled(step, 4)];
  let total = 0;
  for (let i = 0; i < 64; i++) total = (total ^ weigh(points[i % 4]!)) | 0;
  return total;
}

export function writes(seed: number): number {
  const step = seed | 0;
  const points: Point[] = [new Flat(step, 1), new Swapped(2, step), { x: 3, y: step }, new Doubled(step, 4)];
  for (let i = 0; i < 64; i++) bump(points[i % 4]!, i);
  let total = 0;
  for (const p of points) total = (total * 31 + p.x + p.y) | 0;
  return total;
}

// The accessor still runs on a write: its getter reads what the setter kept.
export function accessorKept(seed: number): number {
  const d = new Doubled(seed | 0, 0);
  const p: Point = d;
  p.x = (seed | 0) + 5;
  return d.stored + p.x;
}

// expect-ir: all: no call.virtual in weigh
// expect-ir: all: count instanceof in weigh == 4
// expect-ir: all: no call.virtual in bump
