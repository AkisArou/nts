// expect: `throwIfAborted` is not a function, method, accessor or constructor this compiler copies
//
// A closure calling an optional interface method through `!`, inside a `try`.
// The optional method's type (a function type | undefined) has no
// representation, so the call has no raising copy to reach, and the program's
// closure raising gate stays off (#866). This is the one holder left in the runtime
// corpora: `runtime/node/zlib`'s makeAsyncCompressionTransform calls
// `signal.throwIfAborted!()` on a `StreamAbortSignal`.
// The control is
// programs/a-closure-calling-an-optional-interface-method-control, and it
// differs in two things. The receiver is typed as the class `S` rather than
// the interface `Sig`, which is the difference that matters. It also drops the
// `!`, which TypeScript erases on a required class method, so the program
// means the same; the `!` returns once #882 is fixed, because `s.m!()` on a
// class instance aborts today (outcomes/a-method-called-through-a-non-null-assertion).
// Making the method required instead is not a control: that shape aborts for
// its own reason, outcomes/a-closure-calling-a-throwing-interface-method-inside-a-try
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
    s.throwIfAborted!();
    return n;
  });
}
