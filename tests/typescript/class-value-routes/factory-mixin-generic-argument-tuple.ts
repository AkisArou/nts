/*---
description: A generic argument-tuple mixin forwards exact arguments through three bases and preserves derived identities and inherited statics.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-generics, ts-generic-constraints, ts-mixins, ts-inheritance, ts-tuples]
---*/
// Route: cvLayer<A> accepts a typed constructor and returns CVLayer; node runs both constructors with the same tuple and the final new.target.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; extra: number; steps: string[]; }
interface CVState { log: unknown[]; seen: CVItem[]; }
type CVArgs = [CVState, CVValue, number];
interface CVCtor<A extends CVArgs> { new (...args: A): CVItem; label: string; }
class CVA { static label: string = "A"; kind: string = "A"; value: CVValue; target: string; extra: number; steps: string[] = [];
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVA", state, value, extra, this.target); } }
class CVB { static label: string = "B"; kind: string = "B"; value: CVValue; target: string; extra: number; steps: string[] = [];
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVB", state, value, extra, this.target); } }
class CVC { static label: string = "C"; kind: string = "C"; value: CVValue; target: string; extra: number; steps: string[] = [];
  constructor(state: CVState, value: CVValue, extra: number) { this.value = value; this.target = new.target.name; this.extra = extra; state.seen.push(this); state.log.push("construct", "CVC", state, value, extra, this.target); } }
function cvLayer<A extends CVArgs>(Base: CVCtor<A>): CVCtor<A> {
  return class CVLayer extends Base { constructor(...args: A) { super(...args); const [state, value, extra] = args; this.steps.push("layer"); state.log.push("construct", "CVLayer", state, value, extra, new.target.name); } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvChoices: CVCtor<CVArgs>[] = [cvLayer(CVA), cvLayer(CVB), cvLayer(CVC)];
const cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) for (let selected = 0; selected < cvChoices.length; selected++) {
  const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1]; const Ctor: CVCtor<CVArgs> = cvChoices[selected];
  const label = Ctor.label; state.log.push("static.label", label);
  const first = new Ctor(...args), second = new Ctor(...args);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVLayer"], [result.extra, selected + 1], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(result.steps, ["layer"]); assert.sameValue(typeof result.steps, "object");
    for (let candidate = 0; candidate < cvChoices.length; candidate++) { assert.sameValue(result instanceof cvBases[candidate], candidate === selected); assert.sameValue(result instanceof cvChoices[candidate], candidate === selected); }
  }
  const expected: unknown[] = ["static.label", cvLabels[selected]];
  for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, "CVLayer", "construct", "CVLayer", state, input, selected + 1, "CVLayer");
  assert.compareArray(state.log, expected);
}
