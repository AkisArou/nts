// expect: emit-c --napi -> fails-to-compile where arithmetic or pointer type is required
//
// **The expectation names a clang error, not a string in `program.c`.** It said
// `emits-c <text>` and that is a substring match: a fragment taken from broken
// output can also occur in correct output, and this one did. It reported
// `reproduces` after the defect was fixed, and would have gone on doing so.
//
// A truthiness test on an erased value is emitted as a **C cast** rather than as
// a tag check, and clang rejects it:
//
//     program.c:37  v5 = (bool)v0;      // v0 is NtsValue
//     error: operand of type 'NtsValue' where arithmetic or pointer type is
//            required
//
// `NtsValue` is a struct -- a tag and a payload -- so there is nothing for
// `(bool)` to do with it. JavaScript truthiness on an erased value is a question
// about the tag first (`undefined` and `null` are false whatever the payload)
// and about the payload second (`0`, `NaN` and `""` are false, every object is
// true), which is a function rather than a conversion.
//
// **This is the most common remaining error in the corpus**, measured on the
// 14:18 probe binary once `duplicate-type-name` cleared the name collisions that
// were crowding it out of clang's twenty-error limit:
//
//     stream 8 sites   fs 8   events 3   assert 3   timers 1
//
// It refuses nothing. `emit-c` reports success, the wrapper is published, and
// the defect is a line of C that clang will not accept -- so the expectation is
// asserted against the emitted file rather than against stdout, where there is
// nothing to find.
//
// It needs no new `ManagedType`, which is why it is worth separating from
// `arraybufferview-parameter`: that one is a representation question and this is
// a lowering of an operator that already has a runtime answer.

export function truthy(value: unknown): number {
  if (value) return 1;
  return 0;
}

export function negated(value: unknown): number {
  return !value ? 1 : 0;
}

export function run(): number {
  return truthy("x") + negated(undefined);
}
