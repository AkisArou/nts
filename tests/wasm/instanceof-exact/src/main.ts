// Class tests the exact-type rule must answer as the display walk does,
// against node. Each export folds its answers into a number.
class A {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
// One shape, no relation: a `B` must never pass as an `A`.
class B {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class C extends A {
  z = 3;
}
class Base {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
class Sub1 extends Base {
  y = 1;
}
class Sub2 extends Base {
  y = 2;
  w = 4;
}

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

function bit(value: boolean): number {
  return value ? 1 : 0;
}

export function unrelated(seed: number): number {
  const a: unknown = new A(seed, 1);
  const b: unknown = new B(seed, 1);
  return bit(a instanceof A) + 2 * bit(b instanceof A) + 4 * bit(a instanceof B) + 8 * bit(b instanceof B);
}

export function subclass(seed: number): number {
  const c: unknown = new C(seed, 1);
  const a: unknown = new A(seed, 1);
  return bit(c instanceof A) + 2 * bit(c instanceof C) + 4 * bit(a instanceof C);
}

export function twoSubclasses(seed: number): number {
  const s1: unknown = new Sub1(seed);
  const s2: unknown = new Sub2(seed);
  const base: unknown = new Base(seed);
  return (
    bit(s1 instanceof Base) +
    2 * bit(s2 instanceof Base) +
    4 * bit(s1 instanceof Sub2) +
    8 * bit(s2 instanceof Sub1) +
    16 * bit(base instanceof Sub1)
  );
}

export function literalOfShape(seed: number): number {
  const literal: unknown = { x: seed, y: 2 };
  return bit(literal instanceof A) + 2 * bit(literal instanceof B);
}

export function throughErased(seed: number): number {
  const held: any[] = [new A(seed, 1), new B(seed, 2), new C(seed, 3), { x: seed, y: 4 }, seed, 's', null];
  let total = 0;
  for (let i = 0; i < held.length; i++) {
    const value: unknown = held[i];
    total += bit(value instanceof A) + 2 * bit(value instanceof C);
  }
  return total;
}

export function faceFields(seed: number): number {
  const points: Point[] = [new Flat(seed, 1), new Swapped(2, seed), { x: 3, y: seed }];
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const p = points[i % 3]!;
    total += p.x * 3 + p.y + bit(p instanceof Swapped);
  }
  return total;
}
