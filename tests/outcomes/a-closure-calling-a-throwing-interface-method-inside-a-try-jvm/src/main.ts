// run: check
// backend: jvm
//
// Guard for #872: a closure's raising body dispatches the interface call at
// its implementers' raising slot, so attempt catches the throw as in node.
// The class-typed receiver control is
// programs/a-closure-calling-a-throwing-interface-method-inside-a-try-control.

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
