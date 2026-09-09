// expect: an array method with this many arguments
//
// `Array#indexOf` takes an optional second argument, and passing it is refused.
//
//     parts.indexOf("**")        -> lowers
//     parts.indexOf("**", from)  -> REFUSED
//
// `control` must stay clean, or the diagnostic reads as "`indexOf` is not
// supported", which is false and points at the method rather than at its
// arity.
//
// It is one of `path`'s six own-source roots, all of which are in
// `src/glob-matcher.ts`. The site is the globstar scan:
//
//     while ((globstar = parts.indexOf("**", globstar + 1)) !== -1) {
//
// where the second argument is what makes the loop advance. Rewriting it to a
// manual scan would hide the refusal rather than record it, so it stays and
// this fixture stands in for it.

export function control(parts: string[]): number {
  return parts.indexOf("**");
}

export function subject(parts: string[], from: number): number {
  return parts.indexOf("**", from);
}
