// Legal TypeScript that this backend refuses by name.
//
// Every refusal here was reachable and had no producer: `NTS4013` is quoted in
// `benches/jvm-rows.md`, which is a corpus log, and its own comment in `lib.rs`
// says the shape "has never occurred outside the test that found it" -- a test
// that is not in the tree. A refusal nobody produces is a branch nobody has
// watched fire, and the failure it guards against is a class the JVM rejects at
// load with `ClassFormatError: Duplicate field name`.

/// Two properties that are different in TypeScript and the same on the JVM.
///
/// `jvm_member_name` maps every non-alphanumeric ASCII character to `$`, so a
/// space and a hyphen both become one. Four lines of legal TypeScript, and the
/// class would not load.
export class Collides {
  "a b": number = 1;
  "a-b": number = 2;
}

export function reach(it: Collides): number {
  return it["a b"] + it["a-b"];
}
