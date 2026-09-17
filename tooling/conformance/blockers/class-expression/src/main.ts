// expect: compiles
//
// **A regression guard, as of 2026-09-17.** This was a blocker: a class
// expression's members were never entered, so every method inside one was
// reported as `an anonymous declaration outside every walk` -- including the
// constructor, which meant nothing could construct it. Reach when it was
// written, 2026-09-08: 5 occurrences in the `os` program and 34 in `fs`.
//
// It is used rather than avoided because the two are not interchangeable where
// they appear. `internal/uv.ts` needs the class to implement an interface while
// the *binding* it is assigned to carries a different name from the class
// itself, so that `err.constructor.name` reads `"SystemError"` -- which node's
// tests assert -- without a second exported name in the module scope for
// something that is not part of the public surface.
//
// **`constructor.name` is still refused**, and is what the rest of that
// paragraph is waiting on. `blockers/class-as-value` holds it: a compiled class
// keeps no run-time object to read a name off. So this fixture guards the half
// that landed -- the class lowers, its members are emitted and dispatch finds
// them -- and not the half that has not.
//
// This guard keeps the *named* class expression, which is the shape the corpus
// writes. `examples/a-class-expression` covers the anonymous one, where the
// members are named for the layout's stand-in because there is no identifier to
// read; a `static` there is still refused, and deliberately, because a static
// is addressed by name from source and a number is a name nothing can be traced
// back to.

interface Shaped {
  readonly code: string;
  describe(): string;
}

export const Shape = class Inner extends Error implements Shaped {
  readonly code = "ERR_SHAPE";

  constructor(message: string) {
    super(message);
  }

  describe(): string {
    return `${this.code}: ${this.message}`;
  }
};

export function make(message: string): string {
  return new Shape(message).describe();
}
