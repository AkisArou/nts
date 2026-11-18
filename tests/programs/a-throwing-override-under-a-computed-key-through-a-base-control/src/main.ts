// Control for `a-throwing-override-under-a-computed-key-through-a-base`: the
// throwing body is the base's own and nothing overrides it, so the declaration's
// symbol already says the call can raise.

const kRun = Symbol("run");

class Base {
  [kRun](n: number): number {
    if (n > 2) {
      throw new RangeError("big " + n);
    }
    return n * 10;
  }
  run(n: number): number {
    if (n > 2) {
      throw new RangeError("big " + n);
    }
    return n * 10;
  }
}

class Sub extends Base {}

function viaKey(r: Base, n: number): number {
  return r[kRun](n);
}

function viaName(r: Base, n: number): number {
  return r.run(n);
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function pick(n: number): Base {
  return (n & 1) === 0 ? new Base() : new Sub();
}

/** The computed-key call, through a closure inside a `try`. */
export function computed(n: number): number {
  const r = pick(n);
  return attempt(() => viaKey(r, n & 7));
}

/** The same call under a plain name. */
export function named(n: number): number {
  const r = pick(n);
  return attempt(() => viaName(r, n & 7));
}
