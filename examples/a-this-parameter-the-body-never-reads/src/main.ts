// A `this` parameter is a type annotation about the *caller's* receiver. It is
// erased before any backend sees it, so a body that never mentions `this`
// cannot observe which receiver it was called with -- and is a closure like any
// other.
//
// `binds_this` used to answer `true` on the parameter alone, which refused
// `events`' `onceRecord`:
//
//     const wrapper: Listener = function (this: unknown, ...args: unknown[]) {
//       ... target.removeListener(type, wrapper) ...
//     };
//
// 78 occurrences across ten modules, from one construct, under a message that
// said `uses its own `this`` about a body that does not. The refusing half --
// a body that really does read `this` -- stays refused and is carried by
// `tooling/conformance/blockers/a-call-with-a-receiver-that-is-read`, whose
// two arms both read `this.v`.

type Fn = (...args: number[]) => number;

/**
 * The shape from `events`: annotated, never read, closing over local state.
 *
 * The capture is what makes this more than a plain function -- if the `this`
 * parameter were not dropped the closure's layout would be wrong, not merely
 * refused, so an arm that captures nothing would not test the same thing.
 */
export function annotatedOverACapture(a: number, b: number): number {
  let total = 0;
  const add: Fn = function (this: unknown, ...args: number[]): number {
    for (const n of args) {
      total += n;
    }
    return total;
  };
  add(a);
  return add(b);
}

/**
 * Called with an explicit receiver the body ignores.
 *
 * `f.call(receiver, ...)` lowers by dropping the receiver, and this says that
 * is *correct* when the body never reads it -- node computes the same answer
 * for any receiver at all, which is the whole claim.
 */
export function receiverIsIgnored(n: number): number {
  const f: Fn = function (this: unknown, ...args: number[]): number {
    return args.length + n;
  };
  return f.call({ irrelevant: 1 }, 1, 2, 3);
}

/** The same annotation on a nested function *declaration* rather than an expression. */
export function declaredNotExpression(n: number): number {
  function inner(this: unknown, k: number): number {
    return k * 2 + n;
  }
  return inner(n);
}

/** Control: a `function` expression with no `this` parameter, which lowered before. */
export function noThisParameter(n: number): number {
  const f: Fn = function (...args: number[]): number {
    return args.length + n;
  };
  return f(1, 2);
}

/** Control: an arrow, which has no `this` of its own and never did. */
export function anArrow(n: number): number {
  const f: Fn = (...args: number[]): number => args.length + n;
  return f(1);
}
