/*---
description: "Control for member-generic-capture-replacement; A generic closure retains its captured enum-member value while the interface field supplying later closures is replaced."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-type-aliases, ts-unions, ts-literal-types, ts-interfaces, ts-generics, ts-generic-constraints, ts-closures, ts-arrow-functions, ts-function-types]
---*/
// Member-typed values are captured before and after a field write; node logs the first capture twice and the new capture once without mixing numeric and textual zero. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const CapturedMember = Object.freeze({ Zero: 0, TextZero: "0", Empty: "", Alias: 0 }); type CapturedMember = 0 | "0" | "";
type CapturableMember = 0 | "0" | "";
interface CaptureCell<T> { value: T; }
function capture<T extends CapturableMember>(value: T, log: unknown[]): () => T { return () => { log.push("captured", value, typeof value); return value; }; }
const inputs: CapturableMember[] = [CapturedMember.Zero, CapturedMember.TextZero, CapturedMember.Empty, CapturedMember.Alias], replacements: CapturableMember[] = [CapturedMember.TextZero, CapturedMember.Empty, CapturedMember.Alias, CapturedMember.TextZero];
const raw: (number | string)[] = [0, "0", "", 0], next: (number | string)[] = ["0", "", 0, "0"];
for (let at = 0; at < inputs.length; at++) {
  const cell: CaptureCell<CapturableMember> = { value: inputs[at] }, log: unknown[] = [], first = capture(cell.value, log);
  same(first(), raw[at]); cell.value = replacements[at]; same(cell.value, next[at]); log.push("write", cell.value);
  const later = capture(cell.value, log); same(first(), raw[at]); same(later(), next[at]);
  exact(log, ["captured", raw[at], typeof raw[at], "write", next[at], "captured", raw[at], typeof raw[at], "captured", next[at], typeof next[at]]);
}
