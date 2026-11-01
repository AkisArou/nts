/*---
description: Control for factory-mixin-inherited-statics; factory records preserve construction, static observations and instance identity.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-mixins, ts-inheritance, ts-tuples, ts-this]
---*/
// Control: class values are factory records; instances are ordered plain objects and ancestry is checked by tags.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; extra: number; steps: string[]; }
interface CVState { log: unknown[]; seen: CVItem[]; }
type CVArgs = [CVState, CVValue, number];
interface CVCtor<A extends CVArgs> { factory: (args: A, target?: string) => CVPlain; label: string; total: number; name: string; tag: string; echo(state: CVState, value: CVValue): CVValue; }
interface CVPlain extends CVItem { tags: string[]; }
function cvBase(kind: string): CVCtor<CVArgs> {
  const tag = "CV" + kind;
  return { label: kind, total: 0, name: tag, tag, echo(state, value) { const before = this.total, receiver = this.name, label = this.label; state.log.push("static.echo", tag, receiver, label, before, state, value); this.total = before + 1; return value; },
    factory(args, target = tag) { const [state, value, extra] = args; const result: CVPlain = { kind, value, target, extra, steps: [], tags: [tag] }; state.seen.push(result); state.log.push("construct", tag, state, value, extra, target); return result; } };
}
const CVA = cvBase("A"), CVB = cvBase("B"), CVC = cvBase("C");
function cvLayer(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  const tag = Base.tag + ":static";
  return { label: Base.label, total: Base.total, name: "CVStaticLayer", tag, echo: Base.echo, factory(args, target = "CVStaticLayer") { const result = Base.factory(args, target); const [state, value, extra] = args; result.steps.push("static"); result.tags.push(tag); state.log.push("construct", "CVStaticLayer", state, value, extra, target); return result; } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) {
  const choices: CVCtor<CVArgs>[] = [cvLayer(CVA), cvLayer(CVB), cvLayer(CVC)];
  for (let selected = 0; selected < choices.length; selected++) {
    const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1], Ctor = choices[selected], Base = cvBases[selected];
    const label = Ctor.label; state.log.push("static.label", label);
    const first = Ctor.factory(args), second = Ctor.factory(args);
    assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
    const echoed = Ctor.echo(state, input), empty = Ctor.echo(state, undefined), total = Ctor.total, baseTotal = Base.total; state.log.push("static.total", total, baseTotal);
    const results = [first, second];
    for (let at = 0; at < results.length; at++) {
      const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
      const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVStaticLayer"], [result.extra, selected + 1], [label, cvLabels[selected]], [echoed, input], [empty, undefined], [total, 2], [baseTotal, 0]];
      for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
      assert.compareArray(result.steps, ["static"]); assert.sameValue(typeof result.steps, "object");
      for (let candidate = 0; candidate < choices.length; candidate++) { assert.sameValue(result.tags.includes(cvBases[candidate].tag), candidate === selected); assert.sameValue(result.tags.includes(choices[candidate].tag), candidate === selected); }
    }
    const expected: unknown[] = ["static.label", cvLabels[selected]];
    for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, "CVStaticLayer", "construct", "CVStaticLayer", state, input, selected + 1, "CVStaticLayer");
    expected.push("static.echo", cvNames[selected], "CVStaticLayer", cvLabels[selected], 0, state, input, "static.echo", cvNames[selected], "CVStaticLayer", cvLabels[selected], 1, state, undefined, "static.total", 2, 0);
    assert.compareArray(state.log, expected);
  }
}
