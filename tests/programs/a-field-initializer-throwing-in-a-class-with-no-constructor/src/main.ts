// A class that declares no constructor, extending nothing that does, has no
// constructor to call: `new Resolver()` runs its field initializers where the `new`
// is written. So a throwing initializer throws from the constructing body itself,
// and a `try` around the `new` -- or around a closure that makes one -- handles it
// as that body's own call. It was refused instead, for want of a constructor's
// raising copy, and a closure constructing one held the program's raising gate off.
// A class inheriting its constructor is the same after that constructor runs:
// `runtime/node/dns`'s `getDefaultResolver` makes a `Resolver`, which inherits
// `ResolverBase`'s.
//
// The control is the same program whose initializer cannot throw.

function check(n: number): number {
  if (n < 0) {
    throw new RangeError("negative");
  }
  return n;
}

let seed = 0;

class Options {
  timeout = check(seed) * 2;
}

class Resolver extends Options {
  tries = check(seed - 2) + 1;
}

/** A `new` directly inside the `try`. */
export function direct(n: number): number {
  seed = (n & 7) - 3;
  try {
    return new Options().timeout;
  } catch {
    return -1;
  }
}

/** Through a base class's initializer as well as its own. */
export function chained(n: number): number {
  seed = (n & 7) - 3;
  try {
    const made = new Resolver();
    return made.timeout + made.tries;
  } catch {
    return -1;
  }
}

function attempt(make: () => number): number {
  try {
    return make();
  } catch {
    return -2;
  }
}

/** A closure constructing one, dispatched inside a `try`. */
export function throughAClosure(n: number): number {
  seed = (n & 7) - 3;
  return attempt(() => new Resolver().tries);
}

class Based {
  base: number;
  constructor(n: number) {
    this.base = check(n);
  }
}

/** No constructor of its own: `Based`'s runs, then this initializer, here. */
class Inherits extends Based {
  extra = check(seed - 1) * 3;
}

/** An inherited constructor and an own initializer, inside a `try`. */
export function inherited(n: number): number {
  seed = (n & 7) - 3;
  try {
    const made = new Inherits(seed + 2);
    return made.base + made.extra;
  } catch {
    return -1;
  }
}

/** The same through a closure. */
export function inheritedThroughAClosure(n: number): number {
  seed = (n & 7) - 3;
  return attempt(() => new Inherits(seed + 2).extra);
}
