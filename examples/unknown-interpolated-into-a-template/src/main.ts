// An `unknown` interpolated into a template literal, which node's error
// constructors do everywhere -- `internal/errors.ts`, `${parameter} is not a
// valid Brotli parameter` -- and so do ours, being ports of them: 176 refusals
// across `runtime/node` until 2026-10-10, 161 in that one file.
//
// Both spellings, the implicit conversion and `String(value)`, go to
// `nts_value_to_string`, which prints whatever the value turns out to be
// (`hir::Program::printed`). A function prints `function () { [native code] }`
// where node prints its source, which a compiled program does not keep: the
// one deliberate difference, recorded in `docs/conformance/typescript.md`.

/** Control: a string interpolates. */
export function fromString(value: string): string {
  return `value is ${value}`;
}

/** Control: a number interpolates. */
export function fromNumber(value: number): string {
  return `value is ${value}`;
}

/** Under test: an erased value, interpolated. */
export function fromUnknown(value: unknown): string {
  return `value is ${value}`;
}

/** Under test: the same, spelled with an explicit call. */
export function fromUnknownExplicit(value: unknown): string {
  return `value is ${String(value)}`;
}
