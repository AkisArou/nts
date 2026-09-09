// expect: a rest parameter whose element type has no representation
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
