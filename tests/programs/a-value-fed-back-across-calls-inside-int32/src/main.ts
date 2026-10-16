// The control for `a-value-fed-back-across-calls-past-int32`: the same two
// values fed back across a field and across a call, 200 calls of ten million
// rather than 300. The total, 2000000000, fits in an `i32`, so this agreed with
// node even while the fixpoint stopped at its round cap with a bound of about
// 32 steps: the layout was wrong, and no answer reached the point where it
// showed.

class Counter {
  n = 0;
  bump(): number {
    this.n = this.n + 10_000_000;
    return this.n;
  }
}

/// The step is applied through a field.
export function throughAField(): number {
  const counter = new Counter();
  let last = 0;
  for (let i = 0; i < 200; i = i + 1) {
    last = counter.bump();
  }
  return last;
}

function advance(at: number): number {
  return at + 10_000_000;
}

/// The step is applied through a call's parameter and return.
export function throughACall(): number {
  let at = 0;
  for (let i = 0; i < 200; i = i + 1) {
    at = advance(at);
  }
  return at;
}
