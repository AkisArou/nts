// A function that returns `unknown`, and what the caller does with it.
//
// The third face of one idea. An erased *array* stops being erased when every
// store into it agrees; an erased *parameter* when every caller agrees about
// what goes in; an erased *return* when the function agrees with itself about
// what comes out.
//
// The two conditions swap ends between the last two. For a parameter the
// producers are the callers and the consumer is the body; for a return the
// producer is the body and the consumers are the callers. So the pass asks the
// same two questions of the opposite sides: does every `return` give a fresh
// erasure of one kind, and does every call site do nothing with the result but
// test it and unwrap it.
//
// What it is worth is the tag. `docs/records/0019` measured an erased array at
// 11% against a typed one and proved the cost was the per-element tag test —
// NaN-boxing the value to half its size moved the number by 0.1%. The only
// thing that removes a tag test is not having a tag.

// Every `return` erases a number, and the one caller only tests and unwraps.
// So this returns a `double`, and the test folds to a constant.
function pick(n: number): unknown {
  if (n > 0) {
    return n + 1;
  }
  return n - 1;
}

export function unwrapped(n: number): number {
  const got = pick(n);
  if (typeof got === "number") {
    return got + 10;
  }
  return -1;
}

// Two returns that disagree. Narrowing this would pick one of them and hand
// the caller the other's payload under the wrong tag, so it keeps its tag.
function mixed(n: number): unknown {
  if (n > 0) {
    return n;
  }
  return "negative";
}

export function fromMixed(n: number): number {
  const got = mixed(n);
  return typeof got === "string" ? 1 : 2;
}

// Exported, so this pass cannot see every caller. Left alone for the same
// reason an exported parameter is: an outside caller may do anything with it.
export function open(n: number): unknown {
  return n + 1;
}

// A result that goes somewhere other than a test. The caller wants the general
// representation, which sinks the narrowing even though the returns agree.
function agreeing(n: number): unknown {
  return n * 2;
}

function keep(value: unknown): number {
  return typeof value === "number" ? 1 : 0;
}

export function passedOn(n: number): number {
  return keep(agreeing(n));
}
