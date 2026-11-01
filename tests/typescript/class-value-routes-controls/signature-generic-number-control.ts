/*---
description: Control for signature-generic-number; plain factory records retain the same construction history and instance fields.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-generics, ts-closures]
---*/
// Control: factory records and plain instances replace class values; tags reproduce each class test.
function construct<T>(Ctor: { factory: (value: number) => T }, value: number): T { return Ctor.factory(value); }
interface SigItem { tag: string; value: number; target: string; serial: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const inputs: number[] = [0, -0, NaN, 0.5, 2147483648, Infinity];
for (const input of inputs) {
const state: SigState = { log: [], made: [], count: 0 };
interface SigRecord { factory: (value: number) => SigItem; tag: string; code: string; name: string; }
const SigAlpha: SigRecord = { tag: "alpha", code: "alpha:static", name: "SigAlpha", factory(value: number): SigItem { const item: SigItem = { tag: "alpha", value: 0, target: "", serial: 0 }; item.value = value; item.target = "SigAlpha"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigAlpha", value, item.target, item.serial); return item; } };
const SigBeta: SigRecord = { tag: "beta", code: "beta:static", name: "SigBeta", factory(value: number): SigItem { const item: SigItem = { tag: "beta", value: 0, target: "", serial: 0 }; item.value = value; item.target = "SigBeta"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigBeta", value, item.target, item.serial); return item; } };
const SigGamma: SigRecord = { tag: "gamma", code: "gamma:static", name: "SigGamma", factory(value: number): SigItem { const item: SigItem = { tag: "gamma", value: 0, target: "", serial: 0 }; item.value = value; item.target = "SigGamma"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "SigGamma", value, item.target, item.serial); return item; } };
const choices: [SigRecord, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first: SigItem = construct(Ctor, input), second: SigItem = construct(Ctor, input);
  const code = Ctor.code; state.log.push("static", label, code);
  assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [SigItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item.tag === Candidate.tag, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, input, label, 1, "construct", label, input, label, 2, "static", label, tag + ":static"]);
}
}
