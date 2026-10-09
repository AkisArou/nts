// A `throw` from a function called through `call` or `apply`, caught around
// the call.
//
// The checker resolves `f.call(r)` to `CallableFunction.call`, a provided
// signature with no body, and every question the raising analysis asks of a
// call answered for it: "cannot raise". So the `try` handled nothing and the
// `throw` ended the program -- `nts: uncaught Error` where node returns the
// message -- for a declared function, a `function` expression and a value held
// in a parameter alike. Those questions now ask about `f`
// (`FuncBuilder::through_call_or_apply`), one function below the `try` too.
//
// Each export throws when `n & 7` is over 3 and returns otherwise, so every arm
// is its own control. A bound function and a `const` holding a function made at
// run time still escape: `outcomes/a-throw-from-a-function-made-at-run-time`.

function failing(v: number, limit: number): number {
  if (v > limit) {
    throw new Error("over " + String(limit));
  }
  return v;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "not an Error";
}

export function declaredCall(n: number): string {
  try {
    return String(failing.call(undefined, n & 7, 3));
  } catch (e) {
    return message(e);
  }
}

export function declaredApply(n: number): string {
  try {
    return String(failing.apply(undefined, [n & 7, 3]));
  } catch (e) {
    return message(e);
  }
}

const expression = function (v: number, limit: number): number {
  if (v > limit) {
    throw new Error("expression over " + String(limit));
  }
  return v;
};

export function expressionCall(n: number): string {
  try {
    return String(expression.call(undefined, n & 7, 3));
  } catch (e) {
    return message(e);
  }
}

function heldCall(f: (v: number, limit: number) => number, n: number): string {
  try {
    return String(f.call(undefined, n & 7, 3));
  } catch (e) {
    return message(e);
  }
}

export function aParameter(n: number): string {
  return heldCall(failing, n) + " " + heldCall(expression, n);
}

function oneDeeper(n: number): number {
  return failing.call(undefined, n & 7, 3) + 1;
}

/** The `call` one function below the `try`. */
export function belowTheTry(n: number): string {
  try {
    return String(oneDeeper(n));
  } catch (e) {
    return message(e);
  }
}
