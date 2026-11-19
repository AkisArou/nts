// expect: `throwIfAborted` is not a function, method, accessor or constructor this compiler copies
//
// A closure calling an optional interface method through `!`, inside a `try`.
// The optional method's type (a function type | undefined) has no
// representation, so the call has no raising copy to reach, and the program's
// closure raising gate stays off (#866). This is the one holder left in the runtime
// corpora: `runtime/node/zlib`'s makeAsyncCompressionTransform calls
// `signal.throwIfAborted!()` on a `StreamAbortSignal`.
// The one-difference control is
// programs/a-closure-calling-an-optional-interface-method-control: the method
// is required, and called without `!`.

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
