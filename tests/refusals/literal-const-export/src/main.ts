// expect: emit-c --napi -> publishes fromLiteral
//
// FIXED, and kept as a guard. Both constants reach the export table now, and
// the fixture asserts the previously-missing one is published rather than
// asserting the refusal is gone.
//
// It reported `CHANGED  literal-const-export: refuses differently` for a while,
// with no `got:` line under it, and that was the harness rather than the
// backend: `no wrapper for X` is checked against `emit-c`, which prints no
// "nothing refused" on success, so the *fixed* state of a wrapper fixture is
// unrecognisable in that form. `publishes X` is the form that can state it, and
// the empty `got:` was the tell -- a fixture refusing differently would have
// had something to show.
//
// The original defect, kept because the asymmetry is the whole argument:
//
// A numeric constant exported with a *literal* initializer was not published.
// The same constant with a computed initializer was.
//
// Both lines below are `export const <name> = <number>`, both are read by
// compiled code, and they differ only in whether the right-hand side is written
// out or arrived at. `fromComputed` reaches the export table; `fromLiteral`
// does not, and `emit-c` explains it with "is not a function this backend can
// name" -- which is the message for a *value* export and is true of both.
//
// Isolated one variable at a time, because a first pass with nine exports in
// one file gave the opposite answer and looked like a rule about small integers.
// It is not about the value: 50 and 536870888 both fail, 2**53-1 and 50+0 both
// succeed when they are the only export.
//
// The asymmetry is the argument that this is a defect rather than a policy. A
// backend that declined to export values would decline both; one that exported
// them would export both. Folding a literal into its readers and then having
// nothing left to name is the only way to get this shape.
//
// What it costs: `buffer` publishes one of its fifteen exports, and two of the
// missing fourteen were here -- `kStringMaxLength = 536870888` and
// `INSPECT_MAX_BYTES = 50`. Node's tests read both, so `buffer`'s export table
// is the place to confirm the fix is worth what this said it was worth.

export const fromLiteral = 50;
export const fromComputed = 2 ** 53 - 1;

export function total(): number {
  return fromLiteral + fromComputed;
}
