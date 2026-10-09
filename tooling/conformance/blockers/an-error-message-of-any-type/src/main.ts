// expect: a conversion to string from any
//
// `new Error(x)` where `x` is `any`: the message is `ToString(x)`, the
// conversion `blockers/unknown-interpolated-into-a-template` is blocked on for
// an erased value -- the object tag needs a `toString`, and the function tag a
// source text this compiler does not keep (docs/records/0298).
//
// It compiled anyway until 2026-10-09: `error_message` called
// `nts_value_to_string` on any erased argument, without the gate every other
// conversion to a string has, so a `Box` arriving as the message compiled and
// stopped at run time with "String() of tag 6, which the lowering should have
// refused". Refused here now, in the same words as the other conversions, so
// the census counts it with them and the answer arrives with theirs.
//
// The control: a `string` message, which compiles.

class Box {
  v = 1;
}

/** Under test: an erased message that may hold an object. */
export function fromAny(x: any): string {
  return new Error(x).message;
}

export function anObject(): string {
  return fromAny(new Box());
}

/** Control: a string message. */
export function fromString(x: string): string {
  return new Error(x).message;
}
