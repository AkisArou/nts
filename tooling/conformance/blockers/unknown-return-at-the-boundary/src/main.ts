// expect: emit-c --napi -> no wrapper for returnsUnknown: returns unknown
//
// The return half of `unknown-at-the-boundary`, split out because that fixture
// asserted only the parameter half.
//
// It carried both subjects and a comment saying "a fix for one does not imply
// the other" -- and then named `takes unknown` in its expectation, so a fix
// landing only inward would have turned it green with `returns unknown` still
// declined underneath. The comment claimed a property the fixture did not
// enforce. Found by auditing which wrapper forms any expectation actually
// asserts, rather than which appear in fixture text.
//
// `returnsNumber` is the control and crosses.
//
// `returns unknown` is the profile's only one, `async_hooks`'s
// `executionAsyncResource`. An async resource is whatever the caller made it,
// so `unknown` is the honest return type and not a shortcut.

export function returnsNumber(flag: boolean): number {
  return flag ? 1 : 0;
}

export function returnsUnknown(flag: boolean): unknown {
  return flag ? 1 : "one";
}
