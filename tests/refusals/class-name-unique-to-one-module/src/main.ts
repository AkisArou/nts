// expect: emit-c -> emits-c double run(double v0)
//
// The control for `class-name-shared-by-two-modules`: the same class with the
// same fields, declared once. It compiles, which is what makes the other
// fixture's failure about the *name* rather than about a class with an array
// field or a parameter property.
class Frame {
  readonly items: number[] = [];
  readonly start: number;

  constructor(start: number) {
    this.start = start;
  }
}

export function run(n: number): number {
  const f = new Frame(n);
  return f.start + f.items.length;
}
