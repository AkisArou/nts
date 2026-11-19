// Control for `refusals/a-closure-calling-an-optional-interface-method` (#866):
// the same interface with its optional method and the same `!` call, but `make`
// returns the class `S` rather than the interface `Sig`, so the call names
// `S#throwIfAborted`, a method this compiler copies, and the closure's `throw`
// reaches the handler.
//
// Not the required-method shape on the interface: that one aborts for a
// different reason, recorded as
// outcomes/a-closure-calling-a-throwing-interface-method-inside-a-try (#872).

interface Sig {
  aborted: boolean;
  throwIfAborted?(): void;
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
    s.throwIfAborted!();
    return n;
  });
}
