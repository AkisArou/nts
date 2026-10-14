// Control flow and dispatch, where an ordering or a receiver can come apart
// from what JavaScript specifies without anything refusing.

class Base {
  name(): number { return 1; }
  callName(): number { return this.name(); }
}
class Derived extends Base {
  override name(): number { return 2; }
}

/** Virtual dispatch through a base-typed call site. */
export function overrideThroughBase(): number {
  const d: Base = new Derived();
  return d.callName();
}

/** `finally` runs after a `return` is evaluated and before it is delivered. */
export function finallyAfterReturn(): number {
  let seen = 0;
  const inner = (): number => {
    try {
      return seen + 1;
    } finally {
      seen = 100;
    }
  };
  const returned = inner();
  return returned * 1000 + seen;
}

/** A `finally` that returns replaces the value the `try` returned. */
export function finallyOverridesReturn(): number {
  const inner = (): number => {
    try {
      return 1;
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return 2;
    }
  };
  return inner();
}

/** A closure captures the variable, not its value at capture time. */
export function closureCapturesTheBinding(): number {
  let n = 1;
  const read = (): number => n;
  n = 5;
  return read();
}

/** `let` in a loop body gives each iteration its own binding. */
export function perIterationBinding(): number {
  const reads: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    reads.push(() => i);
  }
  let total = 0;
  for (const r of reads) total += r();
  return total;
}

/** Short-circuit means the right operand is not evaluated. */
export function shortCircuitSideEffect(): number {
  let touched = 0;
  const bump = (): boolean => { touched = 1; return true; };
  const answer = false && bump();
  return answer ? -1 : touched;
}

/** A getter is called on each read, not once. */
export function getterCalledEachRead(): number {
  let calls = 0;
  class Counter {
    get value(): number { calls += 1; return calls; }
  }
  const c = new Counter();
  const a = c.value;
  const b = c.value;
  return a * 10 + b;
}

/** Exceptions unwind to the nearest catch, not the outermost. */
export function nearestCatch(): number {
  try {
    try {
      throw new Error("inner");
    } catch {
      return 1;
    }
  } catch {
    return 2;
  }
}
