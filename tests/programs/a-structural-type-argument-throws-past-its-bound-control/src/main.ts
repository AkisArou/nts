// Control for `outcomes/a-structural-type-argument-throws-past-its-bound`
// (#888): `Other` extends `Box` and overrides `m`, so the override edges reach
// it from `read`'s bound and the throw is caught. Main's pin fails this too:
// a throwing override reached through a quiet base is #843's own fix.

class Box {
  m(): number {
    return 1;
  }
}

class Other extends Box {
  readonly n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  override m(): number {
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
