// `x instanceof C` in a loop.
//
// The test is a comparison against a set of descriptor pointers fixed when the
// program was built, so it reads one word out of a header. What it must not do
// is make the object escape: the operand is erased on the way in, and an erase
// is exactly what it wraps.
class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
}

class Circle extends Shape {}

function shape(n: number): Shape {
  if (n % 2 === 0) {
    return new Circle(n);
  }
  return new Shape(n);
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 8 + n; i++) {
    const s = shape(i);
    total = total + (s instanceof Circle ? 1 : 2);
  }
  return total;
}
