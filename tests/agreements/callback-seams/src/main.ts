// A callback is a call, and calls are where this compiler has been coming
// apart. Each answers a number.
//
// # The result narrows the exception defect rather than widening it
//
// Six agree: a callback reading the enclosing scope, writing an enclosing
// binding, called more than once, its return value used, taking two arguments,
// and one callback calling another. Two are refused outright -- a callback
// stored and called later, and one closing over a loop variable.
//
// **Nothing here is wrong.** So calls work, closures work, and the return
// values come back. `agreements/exception-seams` shows an exception does not
// cross a call frame, and this file says that is specific to the unwind path
// rather than to calls in general -- which is a smaller thing to fix and a
// worse thing to have, because it means every ordinary path was tested by
// everything that passes and the error path was tested by nothing.

/** A callback sees the enclosing scope. */
export function callbackSeesScope(): number {
  const base = 10;
  const run = (f: (n: number) => number): number => f(1);
  return run((n) => n + base);
}

/** A callback mutating an enclosing binding. */
export function callbackMutatesScope(): number {
  let total = 0;
  const run = (f: () => void): void => { f(); };
  run(() => { total = 7; });
  return total;
}

/** A callback called more than once. */
export function callbackCalledTwice(): number {
  let n = 0;
  const twice = (f: () => void): void => { f(); f(); };
  twice(() => { n += 1; });
  return n;
}

/** A callback returning a value the caller uses. */
export function callbackReturnUsed(): number {
  const apply = (f: (n: number) => number, v: number): number => f(v);
  return apply((n) => n * 3, 4);
}

/** A callback stored and called later. */
export function callbackStoredAndCalled(): number {
  let held: (() => number) | undefined;
  const store = (f: () => number): void => { held = f; };
  store(() => 6);
  return held === undefined ? -1 : held();
}

/** A callback taking two arguments. */
export function callbackTwoArguments(): number {
  const apply = (f: (a: number, b: number) => number): number => f(2, 3);
  return apply((a, b) => a * 10 + b);
}

/** A callback that closes over a loop variable. */
export function callbackOverLoopVariable(): number {
  let total = 0;
  const run = (f: () => void): void => { f(); };
  for (let i = 1; i <= 3; i++) {
    run(() => { total += i; });
  }
  return total;
}

/** A callback calling another callback. */
export function nestedCallbacks(): number {
  const outer = (f: (g: () => number) => number): number => f(() => 5);
  return outer((g) => g() + 1);
}
