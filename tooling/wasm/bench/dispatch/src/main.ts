// The dispatch benchmark's program: virtual calls and class tests in loops
// the compiler emits, against node running the same TypeScript. Each export
// takes an iteration count and returns a number both arms must agree on.

class Shape {
  area(): number {
    return 0;
  }
}
class Square extends Shape {
  side: number;
  constructor(side: number) {
    super();
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Shape {
  r: number;
  constructor(r: number) {
    super();
    this.r = r;
  }
  area(): number {
    return 3 * this.r * this.r;
  }
}
class Rect extends Shape {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    super();
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h;
  }
}
class Tall extends Rect {
  constructor(w: number) {
    super(w, 2 * w);
  }
}

function shapes(): Shape[] {
  return [new Square(2), new Circle(1), new Rect(2, 3), new Tall(1)];
}

// Four receiver classes at one call site.
export function polymorphic(n: number): number {
  const all = shapes();
  let total = 0;
  for (let i = 0; i < n; i++) total += all[i & 3].area();
  return total;
}

// One receiver class, called through its base type.
export function monomorphic(n: number): number {
  const s: Shape = new Square(3);
  let total = 0;
  for (let i = 0; i < n; i++) total += s.area();
  return total;
}

// A class test that hits for two of four receivers, one of them a subclass.
export function classTest(n: number): number {
  const all = shapes();
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (all[i & 3] instanceof Rect) hits++;
  }
  return hits;
}

// The same arithmetic with no dispatch: the floor the others are read against.
export function fields(n: number): number {
  const r = new Rect(2, 3);
  let total = 0;
  for (let i = 0; i < n; i++) total += r.w * r.h;
  return total;
}
