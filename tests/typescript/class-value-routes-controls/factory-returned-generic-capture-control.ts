/*---
description: Control for factory-returned-generic-capture; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-generics]
---*/
// Control: class values are factory records; instances are ordered plain objects and ancestry is checked by tags.
type CVValue = number | string | undefined | { id: number };
interface CVItem<T> { kind: string; value: CVValue; target: string; seed: T; }
interface CVState { log: unknown[]; seen: object[]; }
interface CVCtor<T> { factory: (state: CVState, value: CVValue) => CVItem<T>; label: string; seed: T; tag: string; }
function cvMake<T>(label: string, seed: T): CVCtor<T> {
  return { label, seed, tag: label, factory(state, value) { const result: CVItem<T> = { kind: label, value, target: "CVCaptured", seed }; state.seen.push(result); state.log.push("construct", "CVCaptured", label, state, value, result.target, seed); return result; } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvChoices: CVCtor<CVValue>[] = [cvMake<number>("A", -0), cvMake<string>("B", "中"), cvMake<{ id: number }>("C", cvIdentity)];
const cvLabels = ["A", "B", "C"]; const cvSeeds: CVValue[] = [-0, "中", cvIdentity];
for (const input of cvInputs) for (let selected = 0; selected < cvChoices.length; selected++) {
  const state: CVState = { log: [], seen: [] }; const Ctor: CVCtor<CVValue> = cvChoices[selected];
  const label = Ctor.label, seed = Ctor.seed; state.log.push("static.label", label, "static.seed", seed);
  const first = Ctor.factory(state, input), second = Ctor.factory(state, input);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVCaptured"], [result.seed, cvSeeds[selected]], [label, cvLabels[selected]], [seed, cvSeeds[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    for (let candidate = 0; candidate < cvChoices.length; candidate++) assert.sameValue(result.kind === cvChoices[candidate].tag, candidate === selected);
  }
  assert.compareArray(state.log, ["static.label", cvLabels[selected], "static.seed", cvSeeds[selected], "construct", "CVCaptured", cvLabels[selected], state, input, "CVCaptured", cvSeeds[selected], "construct", "CVCaptured", cvLabels[selected], state, input, "CVCaptured", cvSeeds[selected]]);
}
