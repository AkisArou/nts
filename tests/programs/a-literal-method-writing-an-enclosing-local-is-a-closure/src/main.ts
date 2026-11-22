// The control for tests/refusals/a-literal-setter-writing-an-enclosing-local
// and tests/refusals/a-local-class-method-writing-an-enclosing-local: the same
// write to an enclosing local, made by an object literal's method called by
// name rather than by a setter or a local class's method.
//
// A literal method that captures is a closure: `value` is assigned inside it,
// so it is captured by reference, through a cell, and the caller's read after
// the call sees the store. Agrees with node, and did before the refusals.

export function afterMethod(n: number): number {
  let value = 0;
  const hook = {
    setNext(next: number): void {
      value = next;
    },
  };
  hook.setNext(n);
  return value;
}

/** The same through an arrow, the closure every other capture is. */
export function afterArrow(n: number): number {
  let value = 0;
  const setNext = (next: number): void => {
    value = next;
  };
  setNext(n);
  return value;
}

/**
 * A write to the body's own local with no binding yet, which takes a fresh
 * binding of this builder's: the case the refusals' rule must leave alone.
 */
export function firstWrite(n: number): number {
  var z: number;
  z = n + 1;
  return z;
}

/** The same before the `var` that declares it, which is hoisted. */
export function hoistedWrite(n: number): number {
  w = n * 2;
  var w: number;
  return w;
}
