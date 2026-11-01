/*---
description: Control for factory-mixin-composition-order; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-mixins, ts-inheritance, ts-tuples]
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
function cvRed(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  const tag = Base.tag + ":red";
  return { label: Base.label, tag, factory(args, target = "CVRed") { const result = Base.factory(args, target); const [state, value, extra] = args; result.steps.push("red"); result.tags.push(tag); state.log.push("construct", "CVRed", state, value, extra, target); return result; } };
}
function cvBlue(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  const tag = Base.tag + ":blue";
  return { label: Base.label, tag, factory(args, target = "CVBlue") { const result = Base.factory(args, target); const [state, value, extra] = args; result.steps.push("blue"); result.tags.push(tag); state.log.push("construct", "CVBlue", state, value, extra, target); return result; } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) for (let selected = 0; selected < cvBases.length; selected++) for (const reverse of [false, true]) {
  const Base = cvBases[selected], Inner = reverse ? cvBlue(Base) : cvRed(Base), Outer = reverse ? cvRed(Inner) : cvBlue(Inner);
  const target = reverse ? "CVRed" : "CVBlue", innerName = reverse ? "CVBlue" : "CVRed", steps = reverse ? ["blue", "red"] : ["red", "blue"];
  const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1];
  const label = Outer.label; state.log.push("static.label", label);
  const first = Outer.factory(args), second = Outer.factory(args);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, target], [result.extra, selected + 1], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(result.steps, steps); assert.sameValue(typeof result.steps, "object");
    for (let candidate = 0; candidate < cvBases.length; candidate++) assert.sameValue(result.tags.includes(cvBases[candidate].tag), candidate === selected);
    assert.sameValue(result.tags.includes(Inner.tag), true); assert.sameValue(result.tags.includes(Outer.tag), true);
  }
  const expected: unknown[] = ["static.label", cvLabels[selected]];
  for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, target, "construct", innerName, state, input, selected + 1, target, "construct", target, state, input, selected + 1, target);
  assert.compareArray(state.log, expected);
}
