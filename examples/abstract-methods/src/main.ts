// `abstract` methods.
//
// The class already worked; the declaration was refused, and the reason it had
// to be lowered rather than skipped is the *signature*. A call through
// `Shape#area` on a `Shape` receiver is an indirect call, and the backend takes
// the function-pointer type from the declaration — with the method refused,
// `virtual_signature` said "no declaration for `Shape#area` to take a signature
// from" and declined the function that called it.
//
// So an abstract method becomes a function with the declared parameters and
// return type and no body, terminated as unreachable. That is the truth rather
// than a placeholder: an abstract class is never instantiated, so its slot is
// never the one dispatch lands on. Every reachable receiver is a subclass whose
// override filled it. The emitted C is
//
//     static double Shape__area(NtsObj_Shape * v0) { __builtin_unreachable(); }
//
// which is a signature and nothing else.

abstract class Shape {
  abstract area(): number;

  // The template-method shape, and the reason abstract methods are worth
  // having: a concrete method on the base calls one the base does not define.
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

// Through the base's declared type, so the call is a dispatch rather than a
// direct call to one implementation.
function measure(shape: Shape): number {
  return shape.describe();
}

export function throughTheBase(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  return measure(new Circle(size)) + measure(new Square(size)) * 1000;
}

// The abstract method called directly on the concrete type, which is a direct
// call and needs no slot at all.
export function directly(n: number): number {
  const size = n > 0 && n < 100 ? n : 3;
  return new Circle(size).area();
}

// An abstract method with parameters, so the signature carries more than a
// return type.
abstract class Scaler {
  abstract scale(by: number, plus: number): number;
  twice(by: number): number {
    return this.scale(by, 0) + this.scale(by, 1);
  }
}

class Doubler extends Scaler {
  base: number;
  constructor(base: number) {
    super();
    this.base = base;
  }
  scale(by: number, plus: number): number {
    return this.base * by + plus;
  }
}

class Halver extends Scaler {
  base: number;
  constructor(base: number) {
    super();
    this.base = base;
  }
  scale(by: number, plus: number): number {
    return this.base / by + plus;
  }
}

function drive(scaler: Scaler, by: number): number {
  return scaler.twice(by);
}

export function withParameters(n: number): number {
  // `by` is never zero, so `Halver` never divides by it.
  const by = n > 0 && n < 100 ? n : 7;
  return drive(new Doubler(2), by) + drive(new Halver(8), by) * 1000;
}

// Three levels: an abstract class extending an abstract class, where the middle
// one implements one method and leaves the other.
abstract class Top {
  abstract one(): number;
  abstract two(): number;
  sum(): number {
    return this.one() + this.two() * 10;
  }
}

abstract class Middle extends Top {
  one(): number {
    return 1;
  }
}

class Bottom extends Middle {
  two(): number {
    return 2;
  }
}

function total(top: Top): number {
  return top.sum();
}

export function threeLevels(n: number): number {
  return total(new Bottom()) + n * 0;
}

// An abstract method whose return type is not a number, so the signature has to
// be right about more than the count of parameters.
abstract class Namer {
  abstract label(): string;
  shout(): string {
    return this.label() + "!";
  }
}

class Loud extends Namer {
  label(): string {
    return "loud";
  }
}

class Quiet extends Namer {
  label(): string {
    return "q";
  }
}

function say(namer: Namer): number {
  return namer.shout().length;
}

export function returningAString(n: number): number {
  return say(new Loud()) + say(new Quiet()) * 1000 + n * 0;
}
