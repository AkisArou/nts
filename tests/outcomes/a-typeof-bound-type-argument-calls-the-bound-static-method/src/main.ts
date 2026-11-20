// run: check
// Pre-existing lowering defect #915, found in #888 review.
// A typeof-bounded generic calls Box.s in every copy, including copies for
// a subclass override and an unrelated structurally matching constructor.
// programs/a-typeof-bound-type-argument-calls-the-bound-static-method-control
// removes only the generic forwarding call and invokes each static directly.
class Box {
  static s(n: number): number { return n + 1; }
}
class Other extends Box {
  static override s(n: number): number { return n + 10; }
}
class Plain {
  static s(n: number): number { return n + 20; }
}
function mk<T extends typeof Box>(c: T, n: number): number { return c.s(n); }
export function derived(n: number): number { return mk(Other, n & 7); }
export function structural(n: number): number { return mk(Plain, n & 7); }
