// `f.apply(receiver, list)` onto a callee that takes its arguments
// **positionally**.
//
// `blockers/call-and-apply-on-a-function-value` predicted this would close with
// `examples/a-fixed-arity-rest-is-positional` and not before it: "there a
// fixed-arity rest has to become positional parameters, and here a literal has
// to become positional arguments. One answer will close both." It was right,
// and the second half cost about thirty lines once the first was in.
//
// What comes out is the same call `.call` would have produced -- no array is
// built at all:
//
//     export func viaApply(fn: managed<obj#4>, x: f64) -> f64 {
//       %2 = call.closure[0] %0(%0, %1) : f64
//
// # Two ways the arity is known, and both are needed
//
// A **literal** written at the call site carries its arity syntactically.
// Asking the checker instead answers nothing useful: `fn.apply(undefined, [x])`
// against `(x: number) => number` widens the literal to `number[]`, which has
// no arity, so a type-only rule would refuse the commonest spelling there is.
//
// A **value** carries it only when its type is a tuple. That is the
// `fn.apply(thisArg, args)` shape with `fn: (...args: A) => T` -- all twelve
// `.apply` sites in `runtime/node` are written that way, and once `A` is pinned
// to a tuple the callee has no rest parameter any more, so this is the path
// they now take rather than the array one.
//
// # The controls
//
// `restCallee` is the shape that always worked: a genuinely variadic callee,
// where the list *is* the rest parameter and is copied into it. It must go on
// working, and it is the one case here that legitimately allocates -- a rest
// parameter is fresh on every call in JavaScript, so passing the caller's array
// through would alias it.
//
// `viaCall` is the same question without the array. If the two ever disagree,
// the receiver handling has drifted rather than the argument handling; record
// 0284 is why the receiver can be dropped at all.
//
// An array of unknown length stays refused, by name, and
// `blockers/call-and-apply-on-a-function-value` holds it.

function makeAdder(n: number): (x: number) => number {
  return (x) => x + n;
}

function makePair(n: number): (a: number, b: number) => number {
  return (a, b) => a * 10 + b + n;
}

/** Under test: a one-element literal onto a one-parameter callee. */
export function oneFromALiteral(n: number): number {
  const fn = makeAdder(n & 7);
  return fn.apply(undefined, [n & 3]);
}

/** Under test: two positions, so the order is observable. */
export function twoFromALiteral(n: number): number {
  const fn = makePair(n & 1);
  return fn.apply(undefined, [n & 3, 4]);
}

/** Under test: a tuple *value* rather than a literal. */
export function fromATupleValue(n: number): number {
  const fn = makePair(n & 1);
  const args: [number, number] = [n & 3, 5];
  return fn.apply(undefined, args);
}

/** Under test: a fixed-arity rest, which is no longer a rest by the time it is asked. */
function forward(...args: [number, number]): number {
  return args[0] * 100 + args[1];
}

export function throughAFixedArityRest(n: number): number {
  const fn: (...args: [number, number]) => number = forward;
  return fn.apply(undefined, [n & 3, 6]);
}

/** Control: a genuinely variadic callee. The list is the rest parameter. */
export function restCallee(n: number): number {
  const fn = (...xs: number[]): number => xs.length * 10 + (xs[0] ?? 0) + n * 0;
  return fn.apply(undefined, [n & 3, 2, 3]);
}

/** Control: `.call`, which takes the same arguments positionally to begin with. */
export function viaCall(n: number): number {
  const fn = makePair(n & 1);
  return fn.call(undefined, n & 3, 4);
}
