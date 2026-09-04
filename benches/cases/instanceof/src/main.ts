// `instanceof` in a hot loop, over a three-class hierarchy.
//
// The classes that satisfy `s instanceof Circle` are fixed when the program is
// built, so the test is a comparison against a descriptor pointer. Nothing here
// allocates: the shapes do not leave the loop.
class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
}

// Each subclass declares a field of its own. Without one they would be
// structurally identical to `Shape` and to each other, and this compiler gives
// two classes of one shape a single descriptor -- so `s instanceof Circle`
// would be true of every shape. The benchmark's checksum catches that
// immediately, which is how this comment came to be written.
class Circle extends Shape {
  radius: number;
  constructor(size: number) {
    super(size);
    this.radius = size + 1;
  }
}

class Square extends Shape {
  side: number;
  constructor(size: number) {
    super(size);
    this.side = size + 2;
  }
}

function shape(i: number): Shape {
  if (i % 3 === 0) {
    return new Circle(i);
  }
  if (i % 3 === 1) {
    return new Square(i);
  }
  return new Shape(i);
}

export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    const s = shape(i);
    if (s instanceof Circle) {
      total = total + 1;
    } else if (s instanceof Square) {
      total = total + 2;
    } else {
      total = total + 3;
    }
  }
  return total;
}
