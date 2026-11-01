// Constructors at two levels of a typed-array chain, with a level between
// them that declares none. `new Derived` runs Derived's body, whose
// `super(...)` runs Base's through Middle, whose `super(...)` builds the view.
// `new Middle` runs Base's. Writes use `fill`: a write through a constant
// index on `this` is refused on its own (recorded separately).
// The control declares no constructors and does the same work at the site.
let trail = 0;
class Base extends Uint8Array {
  constructor(size: number) {
    trail = trail * 10 + 1;
    super(size + 1);
    this.fill(7, 0, 1);
  }
}
class Middle extends Base {}
class Derived extends Middle {
  constructor(size: number) {
    trail = trail * 10 + 2;
    super(size * 2);
    this.fill(9, 1, 2);
  }
}
export function derived(n: number): number {
  trail = 0;
  const bytes = new Derived((n & 7) + 1);
  return bytes.length * 100000 + bytes[0]! * 1000 + bytes[1]! * 100 + trail;
}
export function middle(n: number): number {
  trail = 0;
  const bytes = new Middle((n & 3) + 1);
  return bytes.length * 1000 + bytes[0]! * 10 + trail;
}
