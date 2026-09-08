// expect: lowers
//
// **FIXED in fc0df644, kept as a guard.** Nothing refuses. Spelled `lowers` rather than `nothing refused`
// because the latter also requires the wrapper to carry it, and the
// wrapper's limits here are somebody else's blocker.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// A value indexed out of an array is `T | undefined`. Narrowing it with a guard
// that *throws* removes the `undefined` for the checker. Every later use of it
// lowers -- reading it, comparing it, arithmetic, returning it, and writing it
// into an object as `key: value`. **Only the shorthand spelling refuses.**
//
//     const first = xs[0];
//     if (first === undefined) throw new Error("");
//     return first + 1;          // lowers
//     return { lo: first };      // lowers
//     return { first };          // REFUSED -- an erased value where a
//                                //            concrete representation is wanted
//
// The two spellings are the same program. `{ first }` is sugar for
// `{ first: first }`, the checker gives both the same type, and one of them
// lowers. That asymmetry is the argument that this is a defect and not a
// representation the backend has declined to support: a backend that could not
// put a narrowed value in an object would refuse both.
//
// **`shorthand-naming-a-function` is this same defect with a different value in
// it.** Shorthand properties are not resolved to their binding, and the message
// depends only on what the name refers to: a narrowed local reads "an erased
// value where a concrete representation is wanted", a module-scope function
// reads "a shorthand naming nothing in scope". Two fixtures rather than one,
// because a fix covering one value kind and not the other would leave the other
// reproducing with nothing to say so.
//
// **What it costs.** `os` publishes 17 of node's 23 exports. Two of the six
// missing ones are here, and both use shorthand because node's own code does:
// `cpus` assembles a `CpuInfo` from seven guarded values (`main.ts:306`) and
// `userInfo` assembles a `UserInfo` from three (`main.ts:428`). Rewriting them
// to `key: value` would compile today, and would be rewriting correct source to
// hide a refusal.
//
// **Three functions, and two of them are controls that must stay clean.**
// `narrowedButNotInObject` does the index, the guard and arithmetic on the
// result and never builds an object. `narrowedIntoObjectLiteral` does all of
// that *and* builds the object, spelled out. Both lower today. If either ever
// refuses, this fixture has stopped being about shorthand -- the diagnostic
// would be coming from the narrowing itself, which is a different defect with a
// different fix, and the expectation here would be holding for the wrong reason.
//
// Those controls are why the fixture says "shorthand" rather than "object
// literal", which is what it said when it was written. The first draft asserted
// the same diagnostic and would have reproduced forever; it was the control
// lowering cleanly that located the defect one spelling narrower. A fixture
// built as "the smallest program that produces this diagnostic" does not have
// that property, and the smallest program producing the text is not the
// smallest program having the defect.

export function narrowedButNotInObject(xs: number[]): number {
  const first = xs[0];
  const second = xs[1];
  if (first === undefined || second === undefined) {
    throw new Error("incomplete record");
  }
  // Read, compared and returned. No object literal anywhere.
  if (first > second) {
    return first - second;
  }
  return first + second;
}

export function narrowedIntoObjectLiteral(xs: number[]): { lo: number; hi: number } {
  const first = xs[0];
  const second = xs[1];
  if (first === undefined || second === undefined) {
    throw new Error("incomplete record");
  }
  return { lo: first, hi: second };
}

// The shorthand spelling, because `os` uses it and a fix that handles only the
// explicit `key: value` form would leave both real sites refused.
export function narrowedIntoShorthand(xs: number[]): { first: number } {
  const first = xs[0];
  if (first === undefined) {
    throw new Error("incomplete record");
  }
  return { first };
}
