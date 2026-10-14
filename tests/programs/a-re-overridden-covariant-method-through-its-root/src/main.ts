// A covariant override overridden again at its *narrower* return type, called
// through the root.
//
// `Circle.copy(): Circle` overrides `Shape.copy(): Shape`, which on the JVM
// is a different descriptor, so `Circle` carries a bridge `copy()Shape`.
// `Ring.copy(): Circle` agrees with `Circle` and so has no bridge of its own:
// a `Ring` reached through a `Shape` arrives at `Circle`'s bridge. That bridge
// was the forwarder byte for byte -- an `invokestatic` of `Circle`'s body -- so
// `via(new Ring())` ran `Circle.copy` and answered "circle" where node answers
// "ring". C and LLVM dispatch through the vtable and never saw it. A bridge
// now calls the override virtually, which is javac's rule.
//
// `twice` is the same hazard through a bridge that drops a parameter the
// override does not declare.
class Shape {
  name(): string { return "shape"; }
  copy(): Shape { return new Shape(); }
  scaled(_by: number): Shape { return new Shape(); }
}
class Circle extends Shape {
  override name(): string { return "circle"; }
  override copy(): Circle { return new Circle(); }
  override scaled(): Circle { return new Circle(); }
}
class Ring extends Circle {
  override name(): string { return "ring"; }
  override copy(): Circle { return new Ring(); }
  override scaled(): Circle { return new Ring(); }
}
function pick(n: number): Shape {
  return n === 0 ? new Shape() : n === 1 ? new Circle() : new Ring();
}
function score(name: string): number {
  return name === "ring" ? 3 : name === "circle" ? 2 : name === "shape" ? 1 : 0;
}
export function copied(n: number): number {
  return score(pick(n).copy().name());
}
export function scaled(n: number): number {
  return score(pick(n).scaled(2).name());
}
