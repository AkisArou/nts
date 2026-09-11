// expect: an `apply` whose callee has no rest parameter
//
// **`call` closed, `apply` closed for the shape the corpus writes, and this
// fixture holds the shape it does not.** The expectation has moved through this
// file three times in one day, which is the file working rather than the file
// churning: each move is a smaller claim than the last.
//
//     viaCall    fn.call(undefined, x)              lowers, agrees with node
//     viaApply   fn.apply(undefined, [x])           this refusal
//
// The two share exactly one thing -- the receiver, dropped by the argument
// record 0284 makes -- and differ in the only other thing there is. `call` takes
// its arguments positionally; `apply` takes them as an array. Where the callee's
// parameter *is* a rest, the array is that parameter and `apply` copies it into
// place; all twelve `.apply` sites in `runtime/node` are that shape --
// `fn.apply(thisArg, args)` with `fn: (...args: A) => T` and `args: A`.
//
// `fn` here is `(x: number) => number`, which takes its argument **positionally**,
// so the literal's arity would have to be spread across parameters. That is the
// same question as `examples/a-fixed-arity-rest-is-positional`, from the
// other side: there a fixed-arity rest has to become positional parameters, and
// here a literal has to become positional arguments. One answer will close both.
//
// `examples/a-call-with-an-explicit-receiver` is the guard for the half that
// closed, and record 0284 is why the receiver can be dropped at all.
//
// `Function.prototype.call` and `.apply` on a function value. The same function
// value called directly lowers, so it is the method and not the value:
//
//     fn(x)                  -> lowers
//     fn.call(undefined, x)  -> REFUSED
//     fn.apply(undefined, x) -> REFUSED
//
// `makeAdder` is a **precondition, not a subject**. Without a closure anywhere
// in the program, `fn(x)` is refused as `a call of a function value in a
// program with no closures`, which would leave `direct` declined for a reason
// with nothing to do with `.call` -- a control that suppresses the defect. The
// first draft of this fixture had exactly that and read as "all three refuse".
//
// 10 of the 42 sites reporting `a method X with no declaration in the
// hierarchy` are this one: `call` 8, `apply` 2, counted as distinct sites and
// not summed over module cones. They are `http/src/parser.ts` (five, at 520,
// 531, 543, 553 and 564), `events/src/main.ts:919`,
// `url/src/searchparams.ts:475`, `web-platform/src/forms/form-data.ts:204`,
// `diagnostics_channel/src/main.ts:475` and `timers/src/timeout.ts:186`.
// `http`'s five are one `callback.call(this, info)` shape repeated per parser
// hook, which is how upstream dispatches to a user callback with the parser as
// the receiver -- the receiver identity is the point, so it cannot become a
// direct call without changing behaviour.
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

export function direct(fn: (x: number) => number, x: number): number {
  return fn(x);
}

export function viaCall(fn: (x: number) => number, x: number): number {
  return fn.call(undefined, x);
}

export function viaApply(fn: (x: number) => number, x: number): number {
  return fn.apply(undefined, [x]);
}
