// A value that feeds itself across a call or a field climbs past `i32`.
//
// The whole-program fixpoint (`hir::interprocedural::settle`) rebuilds every
// parameter, return and field fact from the previous round, and had no
// widening. A counter field written with its own value plus a step, or a
// position handed to a callee that returns it plus a step, grows by one step
// per round and never settles: the fixpoint stopped at its round cap and
// handed on the facts it had then -- a bound of about 32 steps, true of 32
// calls and of nothing after. 32 steps of ten million fit in an `i32`, so the
// field was laid out as one and the position computed in one, and 300 calls
// wrapped both to -1294967296 where node prints 3000000000.
//
// The control, `a-value-fed-back-across-calls-inside-int32`, makes 200 calls
// instead, whose total fits in an `i32`: it agreed already, because a wrapped
// answer there is never reached.

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
  for (let i = 0; i < 300; i = i + 1) {
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
  for (let i = 0; i < 300; i = i + 1) {
    at = advance(at);
  }
  return at;
}
