// Inheritance costs what it has to and nothing more.
//
// A derived class's fields come after the base's, so a pointer to one is a
// pointer to the other and an upcast is free. A method nothing overrides is a
// static call, however deep the hierarchy. A method something *does* override is
// a load and an indirect call -- and the compiler knows which is which, because
// it has the whole hierarchy and TypeScript closes it.

class Shape {
  name: number;

  constructor(name: number) {
    this.name = name;
  }

  // Overridden below, so a call through a `Shape` dispatches.
  area(): number {
    return 0;
  }

  // Overridden by nobody, so a call to it is static even on a `Square`.
  describe(): number {
    return this.name * 1000 + this.area();
  }
}

class Rectangle extends Shape {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    super(1);
    this.width = width;
    this.height = height;
  }

  area(): number {
    return this.width * this.height;
  }
}

// Three levels, and `Square` reaches `Shape`'s fields through `Rectangle`'s.
class Square extends Rectangle {
  constructor(side: number) {
    super(side, side);
    this.name = 2;
  }

  // `super.area()` is a static call to the implementation one level up, which
  // is the one thing dispatch must *not* do.
  area(): number {
    return super.area() + 0;
  }
}

export function shapeArea(): number {
  return new Shape(0).area();
}

export function rectangleArea(w: number, h: number): number {
  return new Rectangle(w, h).area();
}

export function squareArea(side: number): number {
  return new Square(side).area();
}

// `describe` is declared on `Shape` and calls `this.area()`. Through a
// `Rectangle` that has to reach `Rectangle`'s.
export function describeRectangle(w: number, h: number): number {
  return new Rectangle(w, h).describe();
}

export function describeSquare(side: number): number {
  return new Square(side).describe();
}

// The base's field, read through a derived instance -- which only works if the
// layout puts it at the same offset in both.
export function nameOf(side: number): number {
  return new Square(side).name;
}
