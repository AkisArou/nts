// A union of subclasses upcast to their base, in a loop.
//
// The upcast is a tag read off and discarded. What it must not do is change
// where the object lives: a value that stayed in the frame before the
// declaration widened its type should stay there after.

abstract class Shape {
  abstract area(): number;
  describe(): number { return this.area() * 2; }
}

class Circle extends Shape {
  r: number;
  constructor(r: number) { super(); this.r = r; }
  area(): number { return this.r * this.r; }
}

class Square extends Shape {
  s: number;
  constructor(s: number) { super(); this.s = s; }
  area(): number { return this.s + this.s; }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const shape: Shape = i % 2 === 0 ? new Circle(i) : new Square(i);
    total = total + shape.describe();
  }
  return total;
}
