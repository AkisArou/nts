// Statement forms and evaluation order. Each answers a number.

// A `switchFallthrough` case was written here and cannot exist in this profile:
// the shared tsconfig sets `noFallthroughCasesInSwitch`, so the source is a type
// error (TS7029) and `emit-c` writes nothing. Removed rather than worked around
// -- a sweep may only ask questions the profile allows its own source to ask.

/** A switch matches with strict equality. */
export function switchStrict(): number {
  const v: number | string = 1;
  switch (v) {
    case 1: return 1;
    default: return 0;
  }
}

/** A labelled break leaves the outer loop. */
export function labelledBreak(): number {
  let count = 0;
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      count += 1;
      if (j === 1) break outer;
    }
  }
  return count;
}

/** A labelled continue skips to the outer loop's next iteration. */
export function labelledContinue(): number {
  let count = 0;
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (j === 1) continue outer;
      count += 1;
    }
  }
  return count;
}

/** Arguments are evaluated left to right. */
export function argumentOrder(): number {
  let seq = 0;
  const step = (n: number): number => { seq = seq * 10 + n; return n; };
  const add = (a: number, b: number): number => a + b;
  add(step(1), step(2));
  return seq;
}

/** The left side of an assignment is evaluated before the right. */
export function assignmentOrder(): number {
  let seq = 0;
  const xs = [0, 0];
  const index = (): number => { seq = seq * 10 + 1; return 0; };
  const value = (): number => { seq = seq * 10 + 2; return 9; };
  xs[index()] = value();
  return seq;
}

/** A do-while body runs once even when the condition is false. */
export function doWhileRunsOnce(): number {
  let n = 0;
  do { n += 1; } while (false);
  return n;
}

/** A for loop's update runs after the body, not before. */
export function forUpdateAfterBody(): number {
  let seen = -1;
  for (let i = 0; i < 1; i++) { seen = i; }
  return seen;
}

// `throwAcrossACall` lived here and now has its own case file,
// `a-throw-across-a-call`, with the control that makes it precise: a throw in
// the try's own body *is* caught, and the call is what breaks it.

/** A recursive call to a reasonable depth. */
export function recursion(): number {
  const down = (n: number): number => (n <= 0 ? 0 : 1 + down(n - 1));
  return down(100);
}
