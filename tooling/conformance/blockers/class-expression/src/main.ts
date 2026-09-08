// expect: NTS1001 an anonymous declaration outside every walk
//
// A class *expression* assigned to a const, rather than a class declaration.
//
// The compiler walks declarations. A class expression is not one, so its
// members are never entered and every method inside it is reported as being
// outside every walk -- including the constructor, which means nothing can
// construct it.
//
// It is used rather than avoided because the two are not interchangeable where
// they appear here. `internal/uv.ts` needs the class to implement an interface
// while the *binding* it is assigned to carries a different name from the class
// itself, so that `err.constructor.name` reads `"SystemError"` -- which node's
// tests assert -- without a second exported name in the module scope for
// something that is not part of the public surface.
//
// Reach on 2026-09-08: 5 occurrences in the `os` program and 34 in `fs`.

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
