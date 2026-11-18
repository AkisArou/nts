// A call through a base whose method cannot throw reaches whichever body the
// receiver holds, so it can raise what an override can. Asked by the base
// declaration's symbol alone, `r[kRun](n)` read as unable to raise: the closure's
// raising copy dispatched at the ordinary slot, and the override's `throw` ended
// the program from inside a `try` where node catches it. Main refused the
// computed-key spelling; the named spelling was already wrong
// (`outcomes/a-throwing-override-escapes-a-try-through-a-base-that-cannot-throw`).
//
// The control is the same program with the throwing body in the base and no
// override.

const kRun = Symbol("run");

class Base {
  [kRun](n: number): number {
    return n + 1;
  }
  run(n: number): number {
    return n + 1;
  }
}

class Sub extends Base {
  override [kRun](n: number): number {
    if (n > 2) {
      throw new RangeError("big " + n);
    }
    return n * 10;
  }
  override run(n: number): number {
    if (n > 2) {
      throw new RangeError("big " + n);
    }
    return n * 10;
  }
}

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
