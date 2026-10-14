// Dispatch to an abstract method, in a loop.
//
// The abstract declaration is a signature with no body, so nothing about it
// reaches the allocator or a count. What this measures is that adding one did
// not change what the *objects* cost.

abstract class Shape {
  abstract area(): number;
  describe(): number {
    return this.area() * 2;
  }
}

class Circle extends Shape {
  r: number;
  constructor(r: number) {
    super();
    this.r = r;
  }
  area(): number {
    return this.r * this.r;
  }
}

class Square extends Shape {
  s: number;
  constructor(s: number) {
    super();
    this.s = s;
  }
  area(): number {
    return this.s * this.s;
  }
}

function measure(shape: Shape): number {
  return shape.describe();
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    total = total + measure(new Circle(i)) + measure(new Square(i));
  }
  return total;
}
