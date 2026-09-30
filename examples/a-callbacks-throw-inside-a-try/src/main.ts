// A callback's `throw` inside a `try`, in the four spellings a callee can arrive
// in, reaching the handler beside it.
//
// **This was `blockers/a-callbacks-throw-inside-a-try`, and before that a silent
// escape.** `try { fn(); } catch` where `fn` is a *parameter* compiled clean and a
// `throw` raised by whatever was passed in abandoned the program where node's
// `catch` runs, with no diagnostic anywhere. The refusal that replaced it is the
// one `Hierarchy::raising_call_slot` now answers, so this file's whole subject
// moved from "refuses by name" to "agrees with node".
//
// It is what `assert.throws` **is**: 3,601 of test262's 15,078 positive
// `test/language` cases call it, so until this worked every expected-exception test
// read as a wrong answer with one bug as the cause.
//
// # The arms, which were one bug in four spellings
//
// Each passes a different shape into the same `call`, and each escaped on its own
// before the refusal: a declaration, a function expression, an arrow at the call
// site, and an arrow held in a `const`. They are here together because a fix
// covering the arrow written at the call site and not the variable holding one would
// pass a single-arm fixture -- and, when this was an escape rather than a refusal,
// because an escaped throw *ends the program*, so in one file only the first failing
// arm was observable.
//
// # The controls, each differing in one thing
//
//     direct    the same `try` around a *direct* call to the same thrower. It says
//               the subject is the callee being a **value** rather than `try`
//               itself: that path worked all along, by naming the callee's own
//               raising copy.
//     pure      a `try` around a direct call to a function that cannot throw. It
//               must keep compiling and must gain nothing: refusing -- or now,
//               dispatching -- every call inside a `try` would take working
//               programs away, and `examples/array-buffer` is exactly that shape.
//               It is why the membership test in `calls_compiled_code` is still
//               asked after the parameter arm.
//
// A callback that returns normally is deliberately **not** an arm here: when this
// was a refusal it was `call` that refused, not its call sites, so a quiet callback
// refused too. `examples/a-try-around-a-call-through-a-function-value` holds that
// arm now, where it can be observed rather than only reasoned about.
//
// # And the prediction in its old closing section was wrong, usefully
//
// It read: *"A raising variant of the closure body, which is harder than for a
// declaration: a closure's identity is its layout, so a raising variant is a second
// layout."* A raising variant is a second **entry in the same layout** -- one more
// slot in the dispatch table, filled per closure class -- so identity never enters
// it. Reasoning about the cost from "a closure is its layout" priced a second layout
// and the answer was a second word.

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
