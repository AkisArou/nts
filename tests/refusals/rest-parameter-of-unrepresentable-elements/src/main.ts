// expect: lowers
//
// **Both shapes here lower as of 2026-09-11.** This was a refusal fixture and is
// now a guard, because what it holds down is still worth holding: a rest
// parameter whose arms agree on an element type is an array of it, and one
// whose positions disagree is an array of *erased* values read back through the
// tag. Records 0282 and 0285.
//
// Kept rather than deleted because the homogeneous case and the union-of-tuples
// case took separate fixes, and a guard that runs both is the cheapest way to
// notice if either comes undone.
//
// A rest parameter lowers when its elements have a representation and is
// refused when they do not. `...parts: string[]` is fine; a rest parameter
// typed as a *union of tuples* is not, because there is no single element type
// to lay out.
//
//     homogeneous(...parts: string[])                      -> lowers
//     overloaded(...given: [] | [a: string] | [a, b])       -> REFUSED
//
// `homogeneous` is the control and must stay clean, or the diagnostic reads as
// "a rest parameter is refused", which is false and is a different blocker --
// `rest-parameter-at-the-wrapper` is that one, where the parameter lowers and
// the wrapper declines it. This one never reaches the wrapper.
//
// It is `url`'s largest own-source form, nine of its forty roots, and
// `async_hooks` reports it first as well. The real site is
// `url/src/searchparams.ts:287`:
//
//     append(...given: [] | [name: string] | [name: string, value: string]): void
//
// which is how the WHATWG signature is written: `append` takes one argument or
// two, and the tuple union is what makes that a type rather than a comment.

export function homogeneous(...parts: string[]): number {
  return parts.length;
}

export function overloaded(...given: [] | [a: string] | [a: string, b: string]): number {
  return given.length;
}
