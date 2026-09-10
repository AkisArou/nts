// expect: once-c static bool hasArrayLikeShape(NtsValue v0) {
//
// Kept as a guard. `"length" in value` over an `object`, refused because a type
// **no value in the program can have** declares `length` optionally.
//
// The whole-program answer is over every object type the snapshot holds, and a
// type table holds far more than a program builds. What stood under
// `Buffer.from` was `{ length?, toString?, toLocaleString?, pop?, push?,
// concat?, ... }` — `Array` with every member optional, with no symbol, no
// declaration, no layout, and the type of no node. The refusal is right about a
// value: an optional field is a slot that exists whether or not it was written,
// so `{}` and `{ k: undefined }` are one layout with one erased slot and no test
// of a value can tell them apart. It is not right about a shape nothing holds.
//
// # Why the copy, and why it is this large
//
// **The trigger could not be reduced, and that is a finding rather than a
// shortcut.** `validators.ts` is what brings the type: bisecting `buffer`'s
// seven imports names this file, and truncating it moves the answer at line 229
// — but 229 is the closing brace of `validateAbortSignal`, and every attempt to
// reproduce that function's shape on its own failed. So truncation is localising
// *how much of the file typechecks*, and therefore how much of its type table
// tsgo emits, rather than localising a construct. Four reductions were tried and
// none reproduced: a `const` generic over `readonly string[]`, nested assertion
// predicates, `in`-narrowing on an `unknown`, and the abort-signal predicate
// itself.
//
// A frozen copy is therefore the smallest thing that reproduces. It is the head
// of the real file with the four error classes stood in for, so it does not
// follow `runtime/node/internal/validators.ts` and does not go quietly vacuous
// when the Node lane edits theirs.
//
// # Why `once-c` and not `lowers`
//
// `lowers` asks that **nothing** in the fixture refuses, and the copy refuses
// twenty things that have nothing to do with this: a regular expression
// literal, string conversions, an `unknown` receiver. Those are the scaffolding
// refusing, not the subject, and holding the guard to them would tie it to
// every unrelated construct the file happens to contain — the fixture would go
// red on somebody else's progress and green on nothing.
//
// `hasArrayLikeShape`'s body **is** the subject: it is one `return "length" in
// value`, so if the `in` refuses the function has no body and the emitted C has
// no definition of it. One definition, exactly, is the whole assertion.
//
// # What this certifies and what it does not
//
// That the body was emitted. It does not certify the answer: a constant `false`
// is a body too. `examples/in-on-an-object-a-native-answers-for` is what asks
// node. The check under test here only ever *removes* a refusal, so the failure
// it guards against is a refusal coming back — which is what an absent
// definition looks like.
//
// **Controlled**: with `is_the_type_of_some_node` forced false, this file
// refuses with `an `in` naming `length` on an `object`, which the anonymous
// `{ length?, toString?, ... }` declares optionally`. With it restored, `ask`
// lowers. Both were run.

import "./validators.ts";

function hasArrayLikeShape(value: object): boolean {
  return "length" in value;
}

export function ask(n: number): number {
  return hasArrayLikeShape({ a: n }) ? 1 : 0;
}
