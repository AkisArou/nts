/*---
description: Control for factory-mixin-generic-argument-tuple; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-generics, ts-generic-constraints, ts-mixins, ts-inheritance, ts-tuples]
---*/
// Control: class values are factory records; instances are ordered plain objects and ancestry is checked by tags.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; extra: number; steps: string[]; }
interface CVState { log: unknown[]; seen: CVItem[]; }
type CVArgs = [CVState, CVValue, number];
interface CVCtor<A extends CVArgs> { factory: (args: A, target?: string) => CVPlain; label: string; tag: string; }
interface CVPlain extends CVItem { tags: string[]; }
function cvBase(kind: string): CVCtor<CVArgs> {
  const tag = "CV" + kind;
  return { label: kind, tag, factory(args, target = tag) { const [state, value, extra] = args; const result: CVPlain = { kind, value, target, extra, steps: [], tags: [tag] }; state.seen.push(result); state.log.push("construct", tag, state, value, extra, target); return result; } };
}
const CVA = cvBase("A"), CVB = cvBase("B"), CVC = cvBase("C");
function cvLayer<A extends CVArgs>(Base: CVCtor<A>): CVCtor<A> {
  const tag = Base.tag + ":layer";
  return { label: Base.label, tag, factory(args, target = "CVLayer") { const result = Base.factory(args, target); const [state, value, extra] = args; result.steps.push("layer"); result.tags.push(tag); state.log.push("construct", "CVLayer", state, value, extra, target); return result; } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvChoices: CVCtor<CVArgs>[] = [cvLayer(CVA), cvLayer(CVB), cvLayer(CVC)];
const cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) for (let selected = 0; selected < cvChoices.length; selected++) {
  const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1]; const Ctor: CVCtor<CVArgs> = cvChoices[selected];
  const label = Ctor.label; state.log.push("static.label", label);
  const first = Ctor.factory(args), second = Ctor.factory(args);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVLayer"], [result.extra, selected + 1], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(result.steps, ["layer"]); assert.sameValue(typeof result.steps, "object");
    for (let candidate = 0; candidate < cvChoices.length; candidate++) { assert.sameValue(result.tags.includes(cvBases[candidate].tag), candidate === selected); assert.sameValue(result.tags.includes(cvChoices[candidate].tag), candidate === selected); }
  }
  const expected: unknown[] = ["static.label", cvLabels[selected]];
  for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, "CVLayer", "construct", "CVLayer", state, input, selected + 1, "CVLayer");
  assert.compareArray(state.log, expected);
}
