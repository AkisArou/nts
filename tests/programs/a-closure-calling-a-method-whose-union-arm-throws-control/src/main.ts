// Control for `a-closure-calling-a-method-whose-union-arm-throws`: the same call
// on a receiver typed as the throwing class alone, which the checker resolves to
// the one declaration it runs.

class Big {
  constructor(readonly mode: bigint) {}
  isDir(): boolean {
    if (this.mode > 5n) {
      throw new RangeError("too big");
    }
    return (this.mode & 4n) === 4n;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function pick(n: number): Big {
  return new Big(BigInt(n));
}

/** The class-typed receiver's call, through a closure inside a `try`. */
export function probe(n: number): number {
  const s = pick(n & 7);
  return attempt(() => (s.isDir() ? 1 : 0));
}
