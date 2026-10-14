// expect: emit-c --napi -> publishes returnsUnknown
//
// FIXED, kept as a guard. `unknown` crosses outward.
//
// The other half of `unknown-at-the-boundary`, and they landed together on
// purpose -- see that fixture for why shipping the inward half alone would
// have *reduced* `path`'s published count.
//
// Outward is the switch the boundary had been deferring: an `NtsValue` is a tag
// beside a payload, so handing one to JavaScript means building whichever value
// the tag names. Undefined, null, boolean, number and string each become
// themselves. A reference that is not a string is refused with a `TypeError`,
// for the reason `cross` refuses one everywhere else: an object's identity here
// is an address, and the far side cannot reproduce what it means.
//
// The release is the part that is easy to get wrong and is stated in the
// emitter: a reference inside an erased result is released exactly as a
// `Cross::Str` result is, because the callee handed back a count and the value
// that leaves is a copy the far side owns.

export function returnsNumber(flag: boolean): number {
  return flag ? 1 : 0;
}

export function returnsUnknown(flag: boolean): unknown {
  return flag ? 1 : "one";
}
