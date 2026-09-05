// A union of subclasses upcast to their base, then dispatched through.
//
// The classic shape of object-oriented polymorphism, and not what
// `benches/cases/dispatch` measures — that is a `switch` over an integer
// opcode, which is a jump table. This is a virtual call through a pointer whose
// class the compiler cannot name.
//
// `const shape: Shape = which ? new Circle(i) : new Square(i)` is the line that
// was refused until the upcast landed: the conditional's type is
// `Circle | Square`, two representations, so an erased value with a tag — and
// the declaration wants a `Shape *`. Base-first layout makes reading the tag
// off and keeping the pointer correct, and that is what this times.

abstract class Shape {
  abstract area(): number;
  describe(): number {
    return (this.area() * 2) | 0;
  }
}

class Circle extends Shape {
  r: number;
  constructor(r: number) {
    super();
    this.r = r;
  }
  area(): number {
    return (this.r * 3) | 0;
  }
}

class Square extends Shape {
  s: number;
  constructor(s: number) {
    super();
    this.s = s;
  }
  area(): number {
    return (this.s * 5) | 0;
  }
}

class Tri extends Shape {
  t: number;
  constructor(t: number) {
    super();
    this.t = t;
  }
  area(): number {
    return (this.t * 7) | 0;
  }
}

export function work(seed: number): number {
  const step = seed | 0;
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const which = i & 3;
    const size = (i ^ step) & 0xffff;
    // Three arms, so the union is not a pair and the call site is not
    // bimorphic — which is the case a JIT gets for free and a compiler with the
    // whole hierarchy has to earn.
    const shape: Shape =
      which === 0 ? new Circle(size) : which === 1 ? new Square(size) : new Tri(size);
    total = (total ^ shape.describe()) | 0;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 5;
