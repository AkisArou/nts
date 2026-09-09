// expect: nothing refused
//
// FIXED, and kept as a guard. `??` with an erased left operand.
//
// The cause was not `??` and not the erasure. `value ?? byDefault` with
// `value: unknown` has the TypeScript type `{}`, or a union containing it --
// and `{}` was being given an **object layout**. In TypeScript `{}` is every
// value except `null` and `undefined`, so a number is assignable to it, and
// `const x: {} = n` failed with `a value of type Float { bits: 64 } where
// Managed(Object(TypeId(4))) is wanted`. The checker was right and the
// representation disagreed with it.
//
// An anonymous empty object type erases now. **Anonymous only**: `class Bare {}`
// is the same TypeScript type and a different intent -- instantiated with `new`,
// asked about with `instanceof`, given an identity by having an address -- and
// erasing it would take all three.
//
// The four controls in this file's original header are what made the fix
// findable: each removed one element and still compiled, so `??`, the optional
// parameter, `unknown` in a parameter position and binding an erased value were
// each ruled out before anything was changed. The remaining element was the one
// nobody had named, because it is not written anywhere in the source.
//
// This is the widest single root in the runtime tree.
// `internal/validators.ts:243:16` is `const given = value ?? byDefault;` inside
// `parseFileMode(value: unknown, name: string, byDefault?: number)`, and it
// refuses in **21 of 22 modules** -- every module that reaches a validator.
// The other three validators.ts roots are two regular-expression literals and
// one cascade from them, so of the four sites blocking almost the whole tree
// this is the only one that is not waiting on a regex engine.
//
// # What the controls say it is not
//
// Four reductions, each removing one element and compiling:
//
//     value: number | null,  byDefault: number    compiles   not `??`
//     value: number | null,  byDefault?: number   compiles   not the optional parameter
//     value: unknown, never coalesced             compiles   not `unknown` in a parameter
//     const given = value;   (erased, assigned)   compiles   not binding an erased value
//
// So it is the coalesce of an erased left operand and nothing narrower. Adding
// the `let mode = given;` that follows in validators.ts changes nothing, which
// is why the reduction stops here.
//
// # Two messages, and why the fixture names this one
//
// The same construct refuses two different ways depending on the right operand:
//
//     byDefault: number    a value of type Float { bits: 64 } where
//                          Managed(Object(TypeId(5))) is wanted
//     byDefault?: number   an erased value where a concrete representation
//                          is wanted
//
// A `string` default gives the second message too, so the split is not about
// which concrete type is on the right -- it tracks the optionality. Whether
// that is one defect reported twice or two defects is for whoever fixes it;
// this fixture names the construct and takes the message the runtime tree
// actually hits, because that is the one whose disappearance means the 21
// modules move.
//
// The pair is worth keeping in view: this directory's standing hazard is one
// message covering several causes, and this is the mirror of it.

export function parseMode(value: unknown, byDefault?: number): number {
  const given = value ?? byDefault;
  return typeof given === "number" ? given : 0;
}
