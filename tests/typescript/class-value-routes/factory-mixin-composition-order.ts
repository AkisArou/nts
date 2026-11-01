/*---
description: Opposite orders of two typed constructor mixins preserve every construction level, final new.target and inherited static label across three bases.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-mixins, ts-inheritance, ts-tuples]
---*/
// Route: cvRed and cvBlue return classes over typed constructors; node constructs the selected base then the inner and outer layers in composition order.
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
function cvRed(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  return class CVRed extends Base { constructor(...args: CVArgs) { super(...args); const [state, value, extra] = args; this.steps.push("red"); state.log.push("construct", "CVRed", state, value, extra, new.target.name); } };
}
function cvBlue(Base: CVCtor<CVArgs>): CVCtor<CVArgs> {
  return class CVBlue extends Base { constructor(...args: CVArgs) { super(...args); const [state, value, extra] = args; this.steps.push("blue"); state.log.push("construct", "CVBlue", state, value, extra, new.target.name); } };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvBases: CVCtor<CVArgs>[] = [CVA, CVB, CVC], cvLabels = ["A", "B", "C"], cvNames = ["CVA", "CVB", "CVC"];
for (const input of cvInputs) for (let selected = 0; selected < cvBases.length; selected++) for (const reverse of [false, true]) {
  const Base = cvBases[selected], Inner = reverse ? cvBlue(Base) : cvRed(Base), Outer = reverse ? cvRed(Inner) : cvBlue(Inner);
  const target = reverse ? "CVRed" : "CVBlue", innerName = reverse ? "CVBlue" : "CVRed", steps = reverse ? ["blue", "red"] : ["red", "blue"];
  const state: CVState = { log: [], seen: [] }, args: CVArgs = [state, input, selected + 1];
  const label = Outer.label; state.log.push("static.label", label);
  const first = new Outer(...args), second = new Outer(...args);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(Object.is(first.steps, second.steps), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, target], [result.extra, selected + 1], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(result.steps, steps); assert.sameValue(typeof result.steps, "object");
    for (let candidate = 0; candidate < cvBases.length; candidate++) assert.sameValue(result instanceof cvBases[candidate], candidate === selected);
    assert.sameValue(result instanceof Inner, true); assert.sameValue(result instanceof Outer, true);
  }
  const expected: unknown[] = ["static.label", cvLabels[selected]];
  for (const at of [0, 1]) expected.push("construct", cvNames[selected], state, input, selected + 1, target, "construct", innerName, state, input, selected + 1, target, "construct", target, state, input, selected + 1, target);
  assert.compareArray(state.log, expected);
}
