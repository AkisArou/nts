/*---
description: "Control for member-numeric-union-return; A numeric enum-member union crosses a parameter and return while comparisons select exact member-valued results."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-type-aliases, ts-unions, ts-literal-types, ts-interfaces, ts-narrowing]
---*/
// A declared union of numeric member types reaches one function through interface fields; node logs the selected arm and preserves the returned member kind. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const MemberCode = Object.freeze({ Negative: -3, Zero: 0, Pair: 2, Alias: 2 }); type MemberCode = -3 | 0 | 2;
type ActiveMember = -3 | 0 | 2;
interface MemberCell { value: ActiveMember; }
function shift(value: ActiveMember, log: unknown[]): ActiveMember {
  log.push("input", value, typeof value);
  if (value === MemberCode.Negative) { const member: -3 = value; log.push("negative", member); return MemberCode.Pair; }
  if (value === MemberCode.Zero) { const member: 0 = value; log.push("zero", member); return MemberCode.Negative; }
  const member: 2 = value; log.push("pair", member); return MemberCode.Zero;
}
const inputs: ActiveMember[] = [MemberCode.Negative, MemberCode.Zero, MemberCode.Pair, MemberCode.Alias], raw = [-3, 0, 2, 2], answers = [2, -3, 0, 0], branches = ["negative", "zero", "pair", "pair"];
for (let at = 0; at < inputs.length; at++) {
  const cell: MemberCell = { value: inputs[at] }, log: unknown[] = [], result: ActiveMember = shift(cell.value, log);
  log.push("return", result, typeof result); same(cell.value, raw[at]); same(result, answers[at]);
  exact(log, ["input", raw[at], "number", branches[at], raw[at], "return", answers[at], "number"]);
}
