// Prospective value controls, not a measured fix witness. The existing suite
// deep-chain test is the fix witness. Run this new control against the old
// compiler first, then against the reviewed fix, with the same Node oracle.

let trace = 0;

function mark(n: number, digit: number): number {
  trace = trace * 10 + digit;
  return n & 7;
}

class Primitive {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  valueOf(): number {
    trace = trace * 10 + 3;
    return this.value;
  }
}

function object(n: number): Primitive {
  trace = trace * 10 + 1;
  return new Primitive(n & 7);
}

function text(n: number): string {
  trace = trace * 10 + 2;
  return (n & 1) === 0 ? "a" : "b";
}

// Both calls complete before the object's conversion. The result carries the
// complete trace, so a reordered conversion is visible in the value channel.
export function operandsBeforeConversion(n: number): string {
  trace = 0;
  const result = object(n) + text(n);
  return trace + ":" + result;
}

// The inner binary completes, including ToPrimitive, before the final call.
export function leftAssociated(n: number): string {
  trace = 0;
  const result = object(n) + text(n) + mark(n, 4);
  return trace + ":" + result;
}

// A wrapper stays on the existing expression path. Its inner binary completes
// before the outer object's conversion; this distinguishes the two groupings.
export function rightGrouped(n: number): string {
  trace = 0;
  const result = object(n) + (text(n) + mark(n, 4));
  return trace + ":" + result;
}

// A direct ordinary binary RHS exercises the pending-left-value state.
export function directRightChild(n: number): string {
  trace = 0;
  const result = mark(n, 1) - mark(n, 2) * mark(n, 3);
  return trace + ":" + result;
}

// Mixed operators distinguish the original tree from a reassociated fold.
export function mixedTree(n: number): string {
  trace = 0;
  const result = mark(n, 1) + mark(n, 2) * mark(n, 3) - mark(n, 4);
  return trace + ":" + result;
}

class ThrowingPrimitive {
  value: number;
  fails: boolean;
  constructor(value: number, fails: boolean) {
    this.value = value;
    this.fails = fails;
  }
  valueOf(): number {
    trace = trace * 10 + 3;
    if (this.fails) throw new Error("conversion");
    return this.value;
  }
}

function throwable(n: number): ThrowingPrimitive {
  trace = trace * 10 + 1;
  return new ThrowingPrimitive(n & 7, (n & 1) !== 0);
}

export function conversionThrowKeepsEvaluation(n: number): string {
  trace = 0;
  try {
    const result = throwable(n) + text(n);
    return trace + ":" + result;
  } catch (error) {
    return "caught:" + trace + ":" + (error as Error).message;
  }
}
