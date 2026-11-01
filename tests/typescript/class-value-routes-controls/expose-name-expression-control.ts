/*---
description: Control for expose-name-expression; plain factory records expose the same metadata and preserve each construction.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-class-expression]
---*/
// Control: plain records hold factory and metadata fields; instance tags replace class identity and ancestry.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ExposeRecord { factory: (state: ExposeState, value: ExposeValue) => ExposeItem; tag: string; code: string; name: string;  }
const ExposeAlpha: ExposeRecord = { tag: "alpha", code: "alpha:static", name: "InnerAlpha", factory(state: ExposeState, value: ExposeValue): ExposeItem { const item: ExposeItem = { tag: "alpha", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "InnerAlpha"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "InnerAlpha", state, value, item.target, item.serial); return item; } };
const ExposeBeta: ExposeRecord = { tag: "beta", code: "beta:static", name: "InnerBeta", factory(state: ExposeState, value: ExposeValue): ExposeItem { const item: ExposeItem = { tag: "beta", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "InnerBeta"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "InnerBeta", state, value, item.target, item.serial); return item; } };
const ExposeGamma: ExposeRecord = { tag: "gamma", code: "gamma:static", name: "InnerGamma", factory(state: ExposeState, value: ExposeValue): ExposeItem { const item: ExposeItem = { tag: "gamma", value: undefined, target: "", serial: 0 }; item.value = value; item.target = "InnerGamma"; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "InnerGamma", state, value, item.target, item.serial); return item; } };
const choices: [ExposeRecord, string, string][] = [[ExposeAlpha, "InnerAlpha", "alpha"], [ExposeBeta, "InnerBeta", "beta"], [ExposeGamma, "InnerGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first = Ctor.factory(state, input), second = Ctor.factory(state, input);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const name = Ctor.name; state.log.push("name", name); assert.sameValue(Object.is(name, label), true); assert.sameValue(typeof name, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item.tag === Candidate.tag, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, label, 1, "construct", label, state, input, label, 2, "static", label, tag + ":static", "name", label]);
}
