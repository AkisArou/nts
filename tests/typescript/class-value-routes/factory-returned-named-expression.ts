/*---
description: A typed factory returns three distinct named class expressions that construct exact payloads and expose their captured static labels.
features: [ts-class-value-route-factories, ts-class, ts-class-expression, ts-construct-signatures, ts-functions, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays]
---*/
// Route: cvMake returns a construct-signature value; node constructs the corresponding fresh CVProduct class and retains its captured label.
type CVValue = number | string | undefined | { id: number };
interface CVItem { kind: string; value: CVValue; target: string; }
interface CVState { log: unknown[]; seen: CVItem[]; }
interface CVCtor { new (state: CVState, value: CVValue): CVItem; label: string; }
function cvMake(label: string): CVCtor {
  return class CVProduct { static label: string = label; kind: string; value: CVValue; target: string;
    constructor(state: CVState, value: CVValue) { this.kind = label; this.value = value; this.target = new.target.name; state.seen.push(this); state.log.push("construct", "CVProduct", label, state, value, this.target); }
  };
}
const cvIdentity = { id: 7 }; const cvInputs: CVValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, cvIdentity];
const cvChoices: CVCtor[] = [cvMake("A"), cvMake("B"), cvMake("C")], cvLabels: string[] = ["A", "B", "C"];
for (const input of cvInputs) for (let selected = 0; selected < cvChoices.length; selected++) {
  const state: CVState = { log: [], seen: [] }; const Ctor: CVCtor = cvChoices[selected];
  const label = Ctor.label; state.log.push("static.label", label);
  const first = new Ctor(state, input), second = new Ctor(state, input);
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.seen.length, 2);
  const results = [first, second];
  for (let at = 0; at < results.length; at++) {
    const result = results[at]; assert.sameValue(Object.is(result, state.seen[at]), true); assert.sameValue(typeof result, "object");
    const fields: [unknown, unknown][] = [[result.kind, cvLabels[selected]], [result.value, input], [result.target, "CVProduct"], [label, cvLabels[selected]]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    for (let candidate = 0; candidate < cvChoices.length; candidate++) assert.sameValue(result instanceof cvChoices[candidate], candidate === selected);
  }
  assert.compareArray(state.log, ["static.label", cvLabels[selected], "construct", "CVProduct", cvLabels[selected], state, input, "CVProduct", "construct", "CVProduct", cvLabels[selected], state, input, "CVProduct"]);
}
