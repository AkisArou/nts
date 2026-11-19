// Control for `outcomes/a-closure-calling-a-throwing-interface-method-inside-a-try`
// (#872): `make` returns the class `S` rather than the interface `Sig`, so the
// closure's raising copy calls `S#throwIfAborted@raises` and the `throw`
// reaches the handler in `attempt`.

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

function make(): S {
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
