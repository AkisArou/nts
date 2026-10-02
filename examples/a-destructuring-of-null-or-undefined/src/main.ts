// `RequireObjectCoercible`: destructuring `null` or `undefined` throws a `TypeError`.
//
// Step 1 of `BindingInitialization` for an `ObjectBindingPattern`, and before this it was
// a **silent wrong answer** -- the pattern bound nothing and the program went on.
// `tooling/conformance/outcomes/a-parameter-pattern-given-null` was the record, and
// test262's `destructuring/binding/initialization-requires-object-coercible-{null,
// undefined}.js` plus the `TypeError` half of its `assert.throws: nothing was thrown`
// family are the population.
//
// # Why the empty pattern is the shape that matters
//
// A pattern with elements *reads a property*, and a read of an erased value is already
// refused by name -- measured on the materialised test262 case, `fn({ a })` refuses at the
// argument while `fn({})` lowers to `func fn(arg0: erased)` with a body of `ret`. So the
// silent half is the pattern that reads **nothing**, which is exactly the half no check at
// a read could ever guard.
//
// # Two mechanisms, and both are arms here
//
// A `throw` from the guard reaches a handler in **its own** function directly, and one in
// a *caller* only through a raising copy -- so a function whose parameter list holds an
// object pattern joins `Throwing::any`, the way a class with a throwing field initialiser
// does. A synthesised throw is in no `THROW_STATEMENT`, so without that arm the TypeError
// would reach `nts_uncaught` with the caller's `catch` compiled and watching nothing: an
// abort, which erases every observation in its program and is the worse of the two.
//
//   inTheSameFunction*     the `try` and the destructuring are one frame: a handler edge
//   acrossAFrame*          the `try` is in the caller, so `empty@raises` is what it names
//   throughAClosure        two frames and a closure, which is test262's own shape
//                          (`assert.throws(TypeError, function() { fn(null) })`)
//
// # The controls
//
// `acrossAFrameGivenAnObject`, `inTheSameFunctionGivenAnObject` and `aTypedPattern` must go
// on answering: a guard that fired on a present value would break every destructuring in
// the corpus, and the cost argument rests on the guard being a compare the optimiser can
// fold -- not on it being absent.
//
// **A nested empty pattern is deliberately not an arm.** `({ inner: {} }: any)` refuses with
// *"destructuring something with no fields"* -- the inner level is a property read of an
// erased value, which is the refusal this item's whole scoping rests on, so an arm for it
// would be that refusal wearing this item's name.

function empty({}: any): void {}

function typed({ a }: { a: number }): number {
  return a;
}

function attempt(value: unknown): number {
  try {
    empty(value);
  } catch (e) {
    return e instanceof TypeError ? 1 : 2;
  }
  return 0;
}

/** Across a frame: `attempt`'s `try`, `empty`'s throw, and the raising copy between them. */
export function acrossAFrameGivenNull(n: number): number {
  return attempt(null) * 10 + (n & 7);
}

/** The same for `undefined`, which is the other absence and the other tag. */
export function acrossAFrameGivenUndefined(n: number): number {
  return attempt(undefined) * 10 + (n & 7);
}

/** The control: a present value, which must answer `0` and never throw. */
export function acrossAFrameGivenAnObject(n: number): number {
  return attempt({ a: n }) * 10 + (n & 7);
}

/** test262's own shape: the call is inside a closure the `try` runs. */
export function throughAClosure(n: number): number {
  const run = (f: () => void): number => {
    try {
      f();
    } catch (e) {
      return e instanceof TypeError ? 1 : 2;
    }
    return 0;
  };
  return run(() => empty(null)) * 10 + (n & 7);
}

/**
 * **One frame**, where the handler edge is direct and no raising copy is involved: a
 * variable declaration's pattern rather than a parameter's, which is `bind_pattern`'s
 * other caller.
 */
export function inTheSameFunctionGivenNull(n: number): number {
  const source: any = null;
  try {
    const {} = source;
    return n & 7;
  } catch (e) {
    return e instanceof TypeError ? -1 : -2;
  }
}

/** Its control: the same declaration over a present value. */
export function inTheSameFunctionGivenAnObject(n: number): number {
  const source: any = { a: n };
  try {
    const {} = source;
    return n & 7;
  } catch (e) {
    return e instanceof TypeError ? -1 : -2;
  }
}

/** The control that keeps ordinary destructuring honest: a typed pattern, a real object. */
export function aTypedPattern(n: number): number {
  return typed({ a: n & 7 }) * 3;
}
