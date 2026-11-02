/*---
description: "A numeric enum-member union crosses a parameter and return while comparisons select exact member-valued results."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-enum, ts-type-aliases, ts-unions, ts-literal-types, ts-interfaces, ts-narrowing]
---*/
// A declared union of numeric member types reaches one function through interface fields; node logs the selected arm and preserves the returned member kind.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum MemberCode { Negative = -3, Zero = 0, Pair = 2, Alias = Pair }
type ActiveMember = MemberCode.Negative | MemberCode.Zero | MemberCode.Pair | MemberCode.Alias;
interface MemberCell { value: ActiveMember; }
function shift(value: ActiveMember, log: unknown[]): ActiveMember {
  log.push("input", value, typeof value);
  if (value === MemberCode.Negative) { const member: MemberCode.Negative = value; log.push("negative", member); return MemberCode.Pair; }
  if (value === MemberCode.Zero) { const member: MemberCode.Zero = value; log.push("zero", member); return MemberCode.Negative; }
  const member: MemberCode.Pair = value; log.push("pair", member); return MemberCode.Zero;
}
const inputs: ActiveMember[] = [MemberCode.Negative, MemberCode.Zero, MemberCode.Pair, MemberCode.Alias], raw = [-3, 0, 2, 2], answers = [2, -3, 0, 0], branches = ["negative", "zero", "pair", "pair"];
for (let at = 0; at < inputs.length; at++) {
  const cell: MemberCell = { value: inputs[at] }, log: unknown[] = [], result: ActiveMember = shift(cell.value, log);
  log.push("return", result, typeof result); same(cell.value, raw[at]); same(result, answers[at]);
  exact(log, ["input", raw[at], "number", branches[at], raw[at], "return", answers[at], "number"]);
}
