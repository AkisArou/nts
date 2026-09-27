// An enum member read by its **name** through a bracket: `E["Forward"]`.
//
// That is `E.Forward` written the other way, and the checker types it as the same
// literal -- so the fold that answers the dot form answers this one too. It did not
// reach that fold: the element-access path asks about the **reverse mapping** first,
// whose index is a member's *value* rather than its name, and a string where it
// wanted a number refused as "an enum's reverse mapping at a computed index". The dot
// form compiled all along, which is what made this read as a gap in enums rather
// than in one spelling of them.
//
// The same shape as `cde420c16`, where three readers each required a property access
// for something an element access says identically. Found by the GTK lane on
// `SpinType["STEP_FORWARD"]` in Workbench's Spin Button demo, with `E.B` compiling
// and `E["B"]` refusing as its two arms.
//
// **The boundary is the last arm and it must keep refusing.** A reverse mapping at a
// *computed* index is a different question and answerable only at run time:
// `Colour[n]` for an `n` no member has is `undefined` in JavaScript, while
// TypeScript types the expression `string` regardless -- so a lookup that answered
// the declared type would be wrong exactly where the program is asking. It is listed
// in `tooling/gate/example-refusals` with that reason.

const enum Step {
  Back = 0,
  Forward = 1,
}

enum Colour {
  Red = 0,
  Green = 1,
}

enum Label {
  Short = "s",
  Long = "long",
}

/// The subject: a `const enum` member by name.
export function aConstEnumByName(n: number): number {
  return Step["Forward"] * 100 + n;
}

/// Its control, which has always compiled.
export function aConstEnumByDot(n: number): number {
  return Step.Forward * 100 + n;
}

/// The same for a plain enum, which also emits a reverse-mapping object.
export function aPlainEnumByName(n: number): number {
  return Colour["Green"] * 100 + n;
}

export function aPlainEnumByDot(n: number): number {
  return Colour.Green * 100 + n;
}

/// A string-valued member by name: a constant too, and a managed one.
export function aStringMemberByName(n: number): number {
  return Label["Long"].length * 100 + n;
}

export function aStringMemberByDot(n: number): number {
  return Label.Long.length * 100 + n;
}

/// The reverse mapping at a value the compiler knows, which is exact and unchanged.
export function theReverseMappingAtAConstant(n: number): number {
  return Colour[1].length * 100 + n;
}

/// And the boundary: the reverse mapping at a computed index, which stays refused
/// because `undefined` is the answer for a value no member has.
export function theReverseMappingAtAComputedIndex(n: number): number {
  const at = n > 0 ? 1 : 0;
  return Colour[at].length * 100 + n;
}
