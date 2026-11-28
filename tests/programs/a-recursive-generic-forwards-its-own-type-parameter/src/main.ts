// A generic that forwards its own type parameter to itself, and a pair that
// forward it to each other (#896). A call written in a generic copy pins its
// callee through that copy's own type argument, so `again<Other>` calls
// `again<Other>` and `ping<Other>` calls `pong<Other>`: the copies close over
// one argument each, rather than growing a chain, and `Other#m` runs where it
// matches `Box` only structurally.
//
// Paired with outcomes/a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument,
// whose call is not recursive: this one is what says the copies of copies
// reach a fixed point.

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
    return this.n * 10;
  }
}

function again<T extends Box>(r: T, depth: number): number {
  return depth <= 0 ? r.m() : again(r, depth - 1) + 1;
}

function ping<T extends Box>(r: T, depth: number): number {
  return depth <= 0 ? r.m() : pong(r, depth - 1) + 2;
}

function pong<T extends Box>(r: T, depth: number): number {
  return depth <= 0 ? r.m() + 100 : ping(r, depth - 1) + 3;
}

export function itself(n: number): number {
  return again(new Other(n & 7), n & 3);
}

export function eachOther(n: number): number {
  return ping(new Other(n & 7), n & 3);
}

export function atTheBound(n: number): number {
  return again(new Box(), n & 3) + ping(new Box(), n & 3);
}
