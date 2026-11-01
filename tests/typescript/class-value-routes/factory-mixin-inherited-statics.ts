/*---
description: Typed mixin constructors inherit each base static method while its receiver and writes remain on the generated derived class.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-mixins, ts-inheritance, ts-tuples, ts-this]
---*/
// Route: cvLayer returns three classes inheriting echo and total; node reads the selected base method, updates only the derived total, and preserves constructor identity.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; extra: number; steps: string[]; }
interface CVState { log: unknown[]; seen: CVItem[]; }
type CVArgs = [CVState, CVValue, number];
interface CVCtor<A extends CVArgs> { new (...args: A): CVItem; label: string; total: number; name: string; echo(state: CVState, value: CVValue): CVValue; }
class CVA { static label: string = "A"; static total: number = 0; kind: string = "A"; value: CVValue; target: string; extra: number; steps: string[] = [];
  static echo(state: CVState, value: CVValue): CVValue { const before = this.total, receiver = this.name, label = this.label; state.log.push("static.echo", "CVA", receiver, label, before, state, value); this.total = before + 1; return value; }
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVA", state, value, extra, this.target); } }
class CVB { static label: string = "B"; static total: number = 0; kind: string = "B"; value: CVValue; target: string; extra: number; steps: string[] = [];
  static echo(state: CVState, value: CVValue): CVValue { const before = this.total, receiver = this.name, label = this.label; state.log.push("static.echo", "CVB", receiver, label, before, state, value); this.total = before + 1; return value; }
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVB", state, value, extra, this.target); } }
class CVC { static label: string = "C"; static total: number = 0; kind: string = "C"; value: CVValue; target: string; extra: number; steps: string[] = [];
  static echo(state: CVState, value: CVValue): CVValue { const before = this.total, receiver = this.name, label = this.label; state.log.push("static.echo", "CVC", receiver, label, before, state, value); this.total = before + 1; return value; }
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVC", state, value, extra, this.target); } }
function cvLayer(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  return class CVStaticLayer extends Base { constructor(...args: CVArgs) { super(...args); const [state, value, extra] = args; this.steps.push("static"); state.log.push("construct", "CVStaticLayer", state, value, extra, new.target.name); } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) {
  const choices: CVCtor<CVArgs>[] = [cvLayer(CVA), cvLayer(CVB), cvLayer(CVC)];
  for (let selected = 0; selected < choices.length; selected++) {
    const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1], Ctor = choices[selected], Base = cvBases[selected];
    const label = Ctor.label; state.log.push("static.label", label);
    const first = new Ctor(...args), second = new Ctor(...args);
    assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
    const echoed = Ctor.echo(state, input), empty = Ctor.echo(state, undefined), total = Ctor.total, baseTotal = Base.total; state.log.push("static.total", total, baseTotal);
    const results = [first, second];
    for (let at = 0; at < results.length; at++) {
      const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
      const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVStaticLayer"], [result.extra, selected + 1], [label, cvLabels[selected]], [echoed, input], [empty, undefined], [total, 2], [baseTotal, 0]];
      for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
      assert.compareArray(result.steps, ["static"]); assert.sameValue(typeof result.steps, "object");
      for (let candidate = 0; candidate < choices.length; candidate++) { assert.sameValue(result instanceof cvBases[candidate], candidate === selected); assert.sameValue(result instanceof choices[candidate], candidate === selected); }
    }
    const expected: unknown[] = ["static.label", cvLabels[selected]];
    for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, "CVStaticLayer", "construct", "CVStaticLayer", state, input, selected + 1, "CVStaticLayer");
    expected.push("static.echo", cvNames[selected], "CVStaticLayer", cvLabels[selected], 0, state, input, "static.echo", cvNames[selected], "CVStaticLayer", cvLabels[selected], 1, state, undefined, "static.total", 2, 0);
    assert.compareArray(state.log, expected);
  }
}
