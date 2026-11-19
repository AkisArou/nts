// backend: jvm
// run: check
//
// A closure calling a throwing method through an interface-typed receiver,
// reached inside a `try` through a function value (#872). The program's
// closure raising gate is on, so `attempt` dispatches at the raising slot, but
// lowering the closure body with `raises` set fails: `Closure0#erased_call@raises`
// is an abort shell, and every case ends the program with "calling
// `Closure0#call` from inside a `try`, whose raising copy this compiler could
// not build" where node answers `n` or `-1`. A named function making the same
// interface call inside a `try` gets `Sig#throwIfAborted@raises`, so the gap is
// the closure's raising lowering, not the interface family.
//
// Found by #843, measured identically on main's pin 39f4978a7230, on C, LLVM,
// the JVM and C with reference counting.
// The one-difference control is
// programs/a-closure-calling-a-throwing-interface-method-inside-a-try-control:
// `make` returns the class `S` rather than the interface `Sig`.

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
