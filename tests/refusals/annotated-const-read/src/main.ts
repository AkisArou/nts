// expect: so `code` has no storage at any offset and a pointer cast cannot
//         widen a struct
//
// **The diagnosis moved to the assignment on 2026-09-10, and this is the same
// defect named at its cause.** It used to refuse at the *read*, saying `code` is
// not on `Error`. What is actually wrong is one line earlier: `interface Tagged
// extends Error { code?: string }` is a three-field struct and `Error` is a
// two-field one, so `const tagged: Tagged = error` is a pointer cast that widens
// the object, and `tagged.code` reads past the end of what was allocated.
//
// The old message was true and described the symptom. The new one is checked
// rather than assumed: `coerce` emitted a raw pointer cast for every pair of
// object types on the strength of a comment saying base-first layout makes it
// free, which is a fact about a *base* and not about a structural target. The
// unchecked version segfaults where node answers -- measured, on
// `class Thing { id; name }` reaching `interface Named { name }`.
//
// **And on 2026-09-23 it stopped saying "the offsets disagree", which this was
// never an instance of.** One sentence carried two facts with different
// repairs: a target *wider* than the source, where no ordering makes storage
// appear, and two layouts of the same fields in a different order, where laying
// them out alike is the whole fix. This fixture is the first kind, and it says
// so -- above, in prose, since 2026-09-10. The message now says it too.
// See `blockers/an-options-bag-widened-by-assignment` for what reading the one
// as the other cost.
//
// So this fixture reproduces at a different line and for a better stated reason,
// and what it is waiting for is unchanged: an interface's representation when
// both an object literal and a class instance can be one.
//
// The half of the annotated-const blocker that is still open. `blockers/
// annotated-const-write` passes, because the repair widens at the *allocation*
// and its initializer is a `new`. Here the initializer is a **parameter**,
// there is no allocation to widen, and reading a member the declared type has
// and the value's type does not still refuses.
//
// Found by walking into it: extending the process-warning ABI to carry a
// warning's `code` meant reading it off an `Error`-typed parameter, which
// refused and cascaded to every `punycode` export. The ABI passes the code as a
// separate value instead, which is better anyway -- but the refusal is real and
// this is the shape of it.
interface Tagged extends Error {
  code?: string;
}

export function read(error: Error): string {
  const tagged: Tagged = error;
  return tagged.code ?? "";
}
