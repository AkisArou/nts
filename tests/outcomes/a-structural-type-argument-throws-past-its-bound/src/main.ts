// run: check
//
// A throwing method of a class that matches a type parameter's bound only
// structurally (#888). `read<T extends Box>` is called with an `Other`, which
// declares the same members as `Box` but does not extend it, inside a `try` one
// call below. The throw analysis reads `read`'s one body at its bound, where
// `Box#m` cannot raise and the override edges reach only subclasses; lowering's
// copy of `read` for `T = Other` calls `Other#m`, which throws, with no raising
// copy to name. So the program prints 0, 10, 20 and then ends with "uncaught
// RangeError: big" where node answers -1.
//
// Found by #843 while probing its round-4 review, and measured identically on
// main's pin 39f4978a7230: it is older than #843's open gate, which exposes it.
// A `get [kV]` read through the same bound behaves the same way.
//
// The control is programs/a-structural-type-argument-throws-past-its-bound-control,
// and it differs in one thing: `Other` is a subclass of `Box`, which the
// language spells with `extends`, the `super` call and `override`.

class Box {
  m(): number {
    return 1;
  }
}

class Other {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m(): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function read<T extends Box>(r: T): number {
  return r.m();
}

export function probe(n: number): number {
  return attempt(() => read(new Other(n & 7)));
}
