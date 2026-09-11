// expect: an `apply` whose list has no arity the compiler can see
//
// **Narrowed on 2026-09-11, and this is the fourth time the expectation has
// moved through this file — each move a smaller claim than the last.**
//
//     fn(x)                        lowers
//     fn.call(undefined, x)        lowers            record 0284
//     fn.apply(undefined, args)    lowers, callee has a rest parameter
//     fn.apply(undefined, [x])     lowers            record 0288
//     fn.apply(undefined, xs)      this refusal, `xs: number[]`
//
// The previous version of this file held `fn.apply(undefined, [x])` against a
// positional callee and said it was "the same question as
// `examples/a-fixed-arity-rest-is-positional`, from the other side: there a
// fixed-arity rest has to become positional parameters, and here a literal has
// to become positional arguments. One answer will close both." That was right.
// The literal's arity is syntactic, a tuple value's arity is in its type, and
// with either in hand the call is built positionally and no array exists --
// `examples/an-apply-whose-list-has-an-arity` is the guard.
//
// # What is left, and why it is not the same shape
//
// An array with **no arity anywhere**. `xs: number[]` has a length only at run
// time, and the callee has a fixed parameter list, so there is nothing to build
// the argument list from. This is the same remainder
// `blockers/a-spread-into-a-call` now holds, reached from the other direction,
// and it has the same two non-answers: a calling convention with a run-time
// argument count, which no backend here has, or a length check and a throw on a
// path that TypeScript has not proved unsafe.
//
// **TypeScript rejects this too**, which is the strongest argument that the
// refusal is the right behaviour rather than a gap: `@ts-expect-error` below is
// satisfied, so no correct program is being turned away. It is filed because
// the *message* should stay accurate and because a future looser call
// convention would change the answer.
//
// # What did not move
//
// `makeAdder` is a **precondition, not a subject**. Without a closure anywhere
// in the program, `fn(x)` is refused as `a call of a function value in a
// program with no closures`, which would leave `direct` declined for a reason
// with nothing to do with `.call` -- a control that suppresses the defect. The
// first draft of this fixture had exactly that and read as "all three refuse".
//
// The 10 sites that used to be counted here -- `call` 8, `apply` 2, in
// `http/src/parser.ts`, `events`, `url/src/searchparams.ts`,
// `web-platform/src/forms/form-data.ts`, `diagnostics_channel` and
// `timers/src/timeout.ts` -- are all the literal or rest shapes and are no
// longer behind this.
//
// **Ruled out on the way**: that this shares a cause with
// `method-on-a-structural-type`, which asserts the same message. That one's
// receiver is an object written structurally; this one's is a function value,
// and its control constructs a class rather than accepting one. The message is
// one text over at least three causes -- see also `path/src/glob-matcher.ts:41`,
// where the receiver is a `RegExp` whose declaration the entry set never walks
// and the same sentence is printed about a lookup that did not happen. A count
// taken by grepping this message is a count of message texts, not of causes.

export function makeAdder(n: number): (x: number) => number {
  return (x: number): number => x + n;
}

/** Control: the same function value called directly. */
export function direct(fn: (x: number) => number, x: number): number {
  return fn(x);
}

/** Control: `.call`, positional to begin with. Record 0284. */
export function viaCall(fn: (x: number) => number, x: number): number {
  return fn.call(undefined, x);
}

/** Control: the half that closed -- a literal carries its own arity. */
export function viaApplyLiteral(fn: (x: number) => number, x: number): number {
  return fn.apply(undefined, [x]);
}

/** Control: a rest callee, where the list *is* the parameter. */
export function viaApplyRest(fn: (...xs: number[]) => number, x: number): number {
  return fn.apply(undefined, [x, 2]);
}

/** Under test: an array with no arity. Nothing can say how many arguments this is. */
export function viaApplyUnknown(fn: (a: number, b: number) => number, x: number): number {
  const xs: number[] = [x, 2];
  // @ts-expect-error a number[] cannot fill a two-parameter list
  return fn.apply(undefined, xs);
}
