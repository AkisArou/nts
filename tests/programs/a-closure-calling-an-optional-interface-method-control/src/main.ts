// Control for `refusals/a-closure-calling-an-optional-interface-method`: the
// interface method is required and called without `!`, so it has a raising
// copy and the closure's `throw` reaches the handler.

interface Sig {
  aborted: boolean;
  throwIfAborted(): void;
}

class S implements Sig {
  aborted = false;
  throwIfAborted(): void {
    if (this.aborted) throw new RangeError("aborted");
  }
}

function make(): Sig {
  return new S();
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

export function probe(n: number): number {
  const s = make();
  s.aborted = (n & 1) === 1;
  return attempt(() => {
    s.throwIfAborted();
    return n;
  });
}
