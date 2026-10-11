// `infer_implements`: which classes implement an interface without writing
// it. See `tests/inferred_implements.rs`. Every class has a field of its own,
// so that each is laid out as itself rather than merged with a shape it
// shares.

interface Shape {
  area(): number;
}

/** Fits `Shape`: the one method, with the same signature. */
class Square {
  side = 2;
  area(): number {
    return this.side * this.side;
  }
}

/** Fits `Shape`, with a member it does not have. */
class Circle {
  r = 1;
  area(): number {
    return 3 * this.r;
  }
  name(): string {
    return "circle";
  }
}

interface Sized {
  size(): number;
}

/** Fits `Sized`; Label's disjoint result does not make it a candidate. */
class Box {
  width = 4;
  size(): number {
    return this.width;
  }
}

class Label {
  text = "l";
  size(): string {
    return this.text;
  }
}

interface Measured {
  measure(): number;
}

/** Does not fit `Measured`: another arity. */
class Scaled {
  k = 3;
  measure(by: number): number {
    return by * this.k;
  }
}

function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}

export function shapes(): number {
  return total([new Square(), new Circle()]);
}

export function others(n: number): string {
  return String(new Box().size()) + new Label().size() + String(new Scaled().measure(n));
}
