/*---
description: Control for signature-fixed-arguments; plain factory records retain the same construction history and instance fields.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static]
---*/
// Control: factory records and plain instances replace class values; tags reproduce each class test.
type SigValue = number | string | undefined | { id: number };
interface SigItem { tag: string; value: SigValue; target: string; serial: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const identity = { id: 17 }; const inputs: SigValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface SigRecord { factory: (state: SigState, value: SigValue) => SigItem; tag: string; code: string; name: string; }
const SigAlpha: SigRecord = { tag: "alpha", code: "alpha:static", name: "SigAlpha", factory(state: SigState, value: SigValue): SigItem { const item: SigItem = { tag: "alpha", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "SigAlpha"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigAlpha", state, value, item.target, item.serial); return item; } };
const SigBeta: SigRecord = { tag: "beta", code: "beta:static", name: "SigBeta", factory(state: SigState, value: SigValue): SigItem { const item: SigItem = { tag: "beta", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "SigBeta"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigBeta", state, value, item.target, item.serial); return item; } };
const SigGamma: SigRecord = { tag: "gamma", code: "gamma:static", name: "SigGamma", factory(state: SigState, value: SigValue): SigItem { const item: SigItem = { tag: "gamma", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "SigGamma"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigGamma", state, value, item.target, item.serial); return item; } };
function construct(Ctor: SigRecord, state: SigState, value: SigValue): SigItem { return Ctor.factory(state, value); }
const choices: [SigRecord, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
const state: SigState = { log: [], made: [], count: 0 };
for (const input of inputs) {
for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first: SigItem = construct(Ctor, state, input), second: SigItem = construct(Ctor, state, input);
  const code = Ctor.code; state.log.push("static", label, code);
  assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [SigItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item.tag === Candidate.tag, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, label, 1, "construct", label, state, input, label, 2, "static", label, tag + ":static"]);
}
}
