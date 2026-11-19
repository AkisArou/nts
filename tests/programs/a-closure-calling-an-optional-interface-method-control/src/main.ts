// Control for `refusals/a-closure-calling-an-optional-interface-method` (#866):
// the same interface with its optional method, but `make` returns the class `S`
// rather than the interface `Sig`, so the call names `S#throwIfAborted`, a
// method this compiler copies, and the closure's `throw` reaches the handler.
//
// The refusal's `!` is dropped here. On a required class method TypeScript
// erases it, so the program means the same; it returns once #882 is fixed,
// because `s.throwIfAborted!()` on a class instance aborts today
// (outcomes/a-method-called-through-a-non-null-assertion). Making the method
// required on the interface instead is not a control either: that shape aborts
// for its own reason, outcomes/a-closure-calling-a-throwing-interface-method-inside-a-try
// (#872).

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
    s.throwIfAborted();
    return n;
  });
}
