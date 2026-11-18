// A call on a union of classes runs whichever arm's method the value holds, and
// the lowering dispatches it as a test per arm, each arm's call carrying the
// site's raising suffix. The checker resolves the call to one arm's declaration,
// and only that arm was given a raising copy: a closure's raising variant named
// `Big#isDir@raises`, which nothing defined, and refused with a cascade citing no
// root. `runtime/node/fs`'s `stats.isDirectory()` on a `Stats | BigIntStats` did
// exactly this.
//
// The control is the same call on a receiver typed as the throwing class alone.

class Small {
  constructor(readonly mode: number) {}
  isDir(): boolean {
    return (this.mode & 4) === 4;
  }
}

class Big {
  constructor(readonly mode: bigint) {}
  isDir(): boolean {
    if (this.mode > 5n) {
      throw new RangeError("too big");
    }
    return (this.mode & 4n) === 4n;
  }
}

type Either = Small | Big;

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function pick(n: number): Either {
  return (n & 1) === 0 ? new Small(n) : new Big(BigInt(n));
}

/** The union receiver's call, through a closure inside a `try`. */
export function probe(n: number): number {
  const s = pick(n & 7);
  return attempt(() => (s.isDir() ? 1 : 0));
}
