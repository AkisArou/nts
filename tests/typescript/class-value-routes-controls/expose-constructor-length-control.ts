/*---
description: Control for expose-constructor-length; plain factory records expose the same metadata and preserve each construction.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-optional-parameters, ts-default-parameters, ts-rest-parameters]
---*/
// Control: plain records hold factory and metadata fields; instance tags replace class identity and ancestry.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; mark: number | undefined; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ExposeRecord { factory: (state: ExposeState, value: ExposeValue, mark?: number) => ExposeItem; tag: string; code: string; name: string; readonly length: number; }
const ExposeAlpha: ExposeRecord = { tag: "alpha", code: "alpha:static", name: "ExposeAlpha", length: 3, factory(state: ExposeState, value: ExposeValue, mark?: number): ExposeItem { const item: ExposeItem = { tag: "alpha", value: undefined, target: "", serial: 0, mark: undefined }; item.value = value; item.target = "ExposeAlpha"; item.serial = ++state.count; item.mark = mark; state.made.push(item); state.log.push("construct", "ExposeAlpha", state, value, item.mark, arguments.length, item.target, item.serial); return item; } };
const ExposeBeta: ExposeRecord = { tag: "beta", code: "beta:static", name: "ExposeBeta", length: 2, factory(state: ExposeState, value: ExposeValue, mark: number = 7): ExposeItem { const item: ExposeItem = { tag: "beta", value: undefined, target: "", serial: 0, mark: undefined }; item.value = value; item.target = "ExposeBeta"; item.serial = ++state.count; item.mark = mark; state.made.push(item); state.log.push("construct", "ExposeBeta", state, value, item.mark, arguments.length, item.target, item.serial); return item; } };
const ExposeGamma: ExposeRecord = { tag: "gamma", code: "gamma:static", name: "ExposeGamma", length: 2, factory(state: ExposeState, value: ExposeValue, ...marks: (number | undefined)[]): ExposeItem { const item: ExposeItem = { tag: "gamma", value: undefined, target: "", serial: 0, mark: undefined }; item.value = value; item.target = "ExposeGamma"; item.serial = ++state.count; item.mark = marks[0]; state.made.push(item); state.log.push("construct", "ExposeGamma", state, value, item.mark, arguments.length, item.target, item.serial); return item; } };
const choices: [ExposeRecord, string, string][] = [[ExposeAlpha, "ExposeAlpha", "alpha"], [ExposeBeta, "ExposeBeta", "beta"], [ExposeGamma, "ExposeGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const omitted: number | undefined = tag === "beta" ? 7 : undefined;
  const first = Ctor.factory(state, input), second = Ctor.factory(state, input, 9);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const length = Ctor.length; state.log.push("length", length); assert.sameValue(Object.is(length, tag === "alpha" ? 3 : 2), true); assert.sameValue(typeof length, "number");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    checks.push([item.mark, serial === 1 ? omitted : 9]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item.tag === Candidate.tag, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, omitted, 2, label, 1, "construct", label, state, input, 9, 3, label, 2, "static", label, tag + ":static", "length", tag === "alpha" ? 3 : 2]);
}
