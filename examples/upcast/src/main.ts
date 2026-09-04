// A union of subclasses where their base is wanted.
//
// `const shape: Shape = n > 0 ? new Circle(n) : new Square(-n)` is how anyone
// writes a hierarchy, and it was refused with "an erased value where a concrete
// representation is wanted". The conditional's own type is `Circle | Square` —
// two representations, so an erased value with a tag — and the declaration says
// `Shape`, which both of them are.
//
// That is an *upcast*, and base-first layout makes it free: a pointer to a
// `Circle` is a pointer to a `Shape` at the same address, with the base's
// fields at the same offsets. The tag is read off and discarded, which is what
// `Unerase` is.
//
// The licence is the checker's rather than a narrowing's, and it is the stronger
// of the two. A narrowing licenses an unerase because a tag was tested on the
// path that reaches it; this licenses one because *every* arm satisfies the
// target, so no path can arrive carrying anything else.

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
    return this.r * this.r * 3;
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

class Tri extends Shape {
  t: number;
  constructor(t: number) {
    super();
    this.t = t;
  }
  area(): number {
    return this.t * 7;
  }
}

function measure(shape: Shape): number {
  return shape.describe();
}

// The declaration, which is where this was found.
export function throughADeclaration(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  const shape: Shape = n > 0 ? new Circle(size) : new Square(size);
  return shape.describe();
}

// A call argument, where the parameter's type is the target.
export function asAnArgument(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  return measure(n > 0 ? new Circle(size) : new Square(size));
}

// A return, where the declared return type is.
function pick(n: number): Shape {
  const size = n > 0 && n < 100 ? n : 3;
  return n > 0 ? new Circle(size) : new Square(size);
}

export function asAReturn(n: number): number {
  return measure(pick(n));
}

// Three arms, so the union is not a pair by accident.
export function threeArms(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  const shape: Shape = n > 1 ? new Circle(size) : n < -1 ? new Square(size) : new Tri(size);
  return shape.describe();
}

// A field declared at the base type, holding whichever subclass was built.
class Holder {
  held: Shape;
  constructor(held: Shape) {
    this.held = held;
  }
  measure(): number {
    return this.held.describe();
  }
}

export function intoAField(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  return new Holder(n > 0 ? new Circle(size) : new Square(size)).measure();
}

// Two levels: the union's arms are at different depths, and the target is the
// root. `Tri` extends `Shape` directly; `Small` extends `Tri`.
class Small extends Tri {
  constructor() {
    super(1);
  }
  area(): number {
    return 1;
  }
}

export function differentDepths(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  const shape: Shape = n > 0 ? new Circle(size) : new Small();
  return shape.describe();
}

// The target being a middle class rather than the root, so the upcast is not
// always all the way up.
export function toAMiddleClass(n: number): number {
  const shape: Tri = n > 0 ? new Tri(2) : new Small();
  return shape.describe();
}
