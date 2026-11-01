/*---
description: Control for expose-error-constructor; plain factory records expose the same metadata and preserve each construction.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-errors, ts-inheritance]
---*/
// Control: plain records hold factory and metadata fields; instance tags replace class identity and ancestry.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; message: string; name: string; ancestors: string[]; constructor: ExposeRecord; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ExposeRecord { factory: (state: ExposeState, value: ExposeValue, target: ExposeRecord) => ExposeItem; tag: string; code: string; name: string;  }
const ExposeAlpha: ExposeRecord = { tag: "alpha", code: "alpha:static", name: "ExposeAlpha", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const message = "alpha message"; state.log.push("construct", "Error", message, target.name); const item: ExposeItem = { message, name: "Error", tag: "alpha", value: undefined, target: "", serial: 0, constructor: target, ancestors: ["Error", "alpha"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeAlpha", state, value, item.target, item.serial); return item; } };
const ExposeBeta: ExposeRecord = { tag: "beta", code: "beta:static", name: "ExposeBeta", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const message = "beta message"; state.log.push("construct", "Error", message, target.name); const item: ExposeItem = { message, name: "Error", tag: "beta", value: undefined, target: "", serial: 0, constructor: target, ancestors: ["Error", "beta"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeBeta", state, value, item.target, item.serial); return item; } };
const ExposeGamma: ExposeRecord = { tag: "gamma", code: "gamma:static", name: "ExposeGamma", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const message = "gamma message"; state.log.push("construct", "Error", message, target.name); const item: ExposeItem = { message, name: "Error", tag: "gamma", value: undefined, target: "", serial: 0, constructor: target, ancestors: ["Error", "gamma"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeGamma", state, value, item.target, item.serial); return item; } };
const choices: [ExposeRecord, string, string][] = [[ExposeAlpha, "ExposeAlpha", "alpha"], [ExposeBeta, "ExposeBeta", "beta"], [ExposeGamma, "ExposeGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first = Ctor.factory(state, input, Ctor), second = Ctor.factory(state, input, Ctor);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    checks.push([item.message, tag + " message"], [item.name, "Error"]);
    assert.sameValue(item.ancestors.includes("Error"), true);
    const exposed = item.constructor; state.log.push("constructor", label, exposed); assert.sameValue(Object.is(exposed, Ctor), true);
    const name = exposed.name; state.log.push("constructor.name", label, name); checks.push([name, label]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item.tag === Candidate.tag, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", "Error", tag + " message", label, "construct", label, state, input, label, 1, "construct", "Error", tag + " message", label, "construct", label, state, input, label, 2, "static", label, tag + ":static", "constructor", label, Ctor, "constructor.name", label, label, "constructor", label, Ctor, "constructor.name", label, label]);
}
