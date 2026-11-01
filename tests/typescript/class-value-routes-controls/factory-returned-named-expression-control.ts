/*---
description: Control for factory-returned-named-expression; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays]
---*/
// Control: class values are factory records; instances are ordered plain objects and ancestry is checked by tags.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; }
interface CVState { log: unknown[]; seen: CVItem[]; }
interface CVCtor { factory: (state: CVState, value: CVValue) => CVItem; label: string; tag: string; }
function cvMake(label: string): CVCtor {
  return { label, tag: label, factory(state, value) { const result: CVItem = { kind: label, value, target: "CVProduct" }; state.seen.push(result); state.log.push("construct", "CVProduct", label, state, value, result.target); return result; } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvChoices: CVCtor[] = [cvMake("A"), cvMake("B"), cvMake("C")], cvLabels: string[] = ["A", "B", "C"];
for (const input of cvInputs) for (let selected = 0; selected < cvChoices.length; selected++) {
  const state: CVState = { log: [], seen: [] }; const Ctor: CVCtor = cvChoices[selected];
  const label = Ctor.label; state.log.push("static.label", label);
  const first = Ctor.factory(state, input), second = Ctor.factory(state, input);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVProduct"], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    for (let candidate = 0; candidate < cvChoices.length; candidate++) assert.sameValue(result.kind === cvChoices[candidate].tag, candidate === selected);
  }
  assert.compareArray(state.log, ["static.label", cvLabels[selected], "construct", "CVProduct", cvLabels[selected], state, input, "CVProduct", "construct", "CVProduct", cvLabels[selected], state, input, "CVProduct"]);
}
