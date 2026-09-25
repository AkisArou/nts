// expect: NTS1001 a call inside a `try` whose `throw` would not reach this handler: through a function value, which has no raising copy to call
//
// **This refusal replaced a silent escape.** `try { fn(); } catch` where `fn` is a
// *parameter* compiled clean, and a `throw` raised by whatever was passed in
// abandoned the program where node's `catch` runs. No diagnostic anywhere.
//
// `throwing` holds symbols whose *declarations* contain a body that throws, and a
// parameter has no such declaration -- so `calls_compiled_code` answered "cannot
// raise" and the `try` was never even considered. The comment above that line
// described the fix (*"if nothing this symbol declares is a function, the callee
// arrived as a value"*) and the code asked `!declarations.is_empty()`, which is true
// of a parameter. A sentence describing a repair that is not there is worse than no
// sentence: it is why this survived the React lane reporting the same shape one
// spelling over.
//
// Found by the conformance lane, and it is what `assert.throws` *is*: **3,601 of
// test262's 15,078 positive `test/language` cases** call it, so until this refused
// or worked, every expected-exception test would have read as a wrong answer with
// one bug as the cause.
//
// # The arms, which are one bug in four spellings
//
// Each passes a different shape into the same `call`, and each escaped on its own
// before the fix: a declaration, a function expression, an arrow at the call site,
// and an arrow held in a `const`. They are here together because a fix covering the
// arrow written at the call site and not the variable holding one would pass a
// single-arm fixture -- and because an escaped throw *ends the program*, so in one
// file only the first failing arm is observable. Once the refusal is a feature,
// these may want to be four fixtures.
//
// # The controls, each differing in one thing
//
//     direct    the same `try` around a *direct* call to the same thrower. It is
//               caught, and it is what says the refusal is about the callee being a
//               value rather than about `try` itself.
//     pure      a `try` around a direct call to a function that cannot throw. It
//               must keep *compiling*: refusing every call inside a `try` would
//               take working programs away, and `examples/array-buffer` is exactly
//               that shape. It is why the membership test in `calls_compiled_code`
//               is still asked after the parameter arm.
//
// A callback that returns normally is deliberately **not** a control: the refusal is
// in `call`, not at its call sites, so passing a quiet callback refuses too. That is
// correct -- nothing here can know what a value throws -- and it is why the
// controls have to be shaped around the callee rather than around the argument. The
// first version of this fixture got that wrong.
//
// # What closing it needs
//
// A raising variant of the *closure* body, which is harder than for a declaration:
// a closure's identity is its layout, so a raising variant is a second layout. Until
// then the refusal is the honest answer, and it is the same gap
// `blockers/a-try-around-a-cycle-of-calls` records one indirection over.

function thrower(): void {
  throw new TypeError("x");
}

/** The subject: the callee is a parameter. */
function call(fn: () => void): number {
  try {
    fn();
  } catch (e) {
    return 1;
  }
  return 0;
}

/** **Control.** The same `try` around a direct call, which is caught. */
function direct(): number {
  try {
    thrower();
  } catch (e) {
    return 1;
  }
  return 0;
}

const held = (): void => {
  throw new RangeError("held");
};

export function viaDeclaration(n: number): number {
  return call(thrower) + n;
}

export function viaExpression(n: number): number {
  return (
    call(function (): void {
      throw new TypeError("expression");
    }) + n
  );
}

export function viaArrow(n: number): number {
  return (
    call((): void => {
      throw new TypeError("arrow");
    }) + n
  );
}

export function viaHeldArrow(n: number): number {
  return call(held) + n;
}

/** **Control.** A `try` around a direct call that cannot throw: must compile. */
function pure(n: number): number {
  try {
    return n * 2;
  } catch (e) {
    return -1;
  }
}

export function viaPure(n: number): number {
  return pure(n);
}

/** **Control.** The direct call, caught. */
export function viaDirect(n: number): number {
  return direct() + n;
}
