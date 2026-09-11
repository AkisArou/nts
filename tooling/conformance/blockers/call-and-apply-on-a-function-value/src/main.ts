// expect: a method `apply` with no declaration in the hierarchy
//
// **`call` closed on 2026-09-11 and `apply` did not**, which is why this
// expectation moved rather than the fixture being deleted. `viaCall` now lowers
// and agrees with node; `viaApply` is what is left, and it is a different
// lowering rather than the same one under another name: `call` takes its
// arguments positionally and `apply` takes them as an array, so the receiver
// question they share is already answered and the argument question is not.
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
