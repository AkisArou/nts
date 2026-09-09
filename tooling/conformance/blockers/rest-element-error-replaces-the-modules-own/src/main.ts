// expect: emit-c --napi -> emits-addon nts_napi_rest(env, info, 0, true, "args"
//
// FIXED, kept as a guard. A rest element of the wrong type gets node's error
// code.
//
//     path.resolve(42)
//       before   Error: could not gather the rest arguments    code undefined
//       now      TypeError: The "args[0]" argument must be of
//                type string. Received type number             code ERR_INVALID_ARG_TYPE
//       node     TypeError                                     code ERR_INVALID_ARG_TYPE
//
// Two of `path`'s nine remaining failures were this one line, and
// `test-path.js` asserts the **code and the name** rather than the text, so
// this is the assertion node makes.
//
// # The expectation, which had to be replaced rather than kept
//
// It used to be `emits-addon could not gather the rest arguments` -- and that
// string is the *fallback message of `nts_napi_check`*, written into every
// addon whether or not anything reaches it. So the fixture would have reported
// `reproduces` forever, against a compiler that had fixed the defect, for the
// same reason `optional-parameter-at-the-wrapper`'s expectation matched the
// output it was written to catch: **the text the fixture named was not the text
// that changed.**
//
// It now names the gatherer's call site with this fixture's own parameter name,
// which is per-fixture and did not exist in that form before.
//
// # Why the boundary throws at all
//
// The module's own validation cannot run. `subject(...args: string[])` types
// every element `string`, so `typeof arg !== "string"` folds to false before
// the body sees it -- the same fold that deletes `validateString` in 23
// exported functions, and the reason the arity check is load-bearing rather
// than officious. The boundary is standing in for a guard the declaration
// removed, so it has to stand in with node's code.
//
// `control` is the non-rest half: its coded error survives the boundary
// untouched, which is what says this was about the gatherer and not about
// errors crossing at all.

class InvalidArgument extends Error {
  readonly code: string;
  constructor(name: string) {
    super(`The "${name}" argument must be of type string.`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

export function control(first: string): string {
  if (first.length === 0) throw new InvalidArgument("first");
  return first;
}

export function subject(...args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg.length === 0) throw new InvalidArgument("paths");
  }
  return args.join("/");
}
