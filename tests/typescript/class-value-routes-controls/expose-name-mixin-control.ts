/*---
description: Control for expose-name-mixin; plain factory records expose the same metadata and preserve each construction.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-class-expression, ts-inheritance, ts-mixins]
---*/
// Control: plain records hold factory and metadata fields; instance tags replace class identity and ancestry.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; layer: string; ancestors: string[]; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ExposeRecord { factory: (state: ExposeState, value: ExposeValue, target: ExposeRecord) => ExposeItem; tag: string; code: string; name: string;  }
const ExposeAlpha: ExposeRecord = { tag: "alpha", code: "alpha:static", name: "ExposeAlpha", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const item: ExposeItem = { tag: "alpha", value: undefined, target: "", serial: 0, layer: "", ancestors: ["alpha"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeAlpha", state, value, item.target, item.serial); return item; } };
const ExposeBeta: ExposeRecord = { tag: "beta", code: "beta:static", name: "ExposeBeta", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const item: ExposeItem = { tag: "beta", value: undefined, target: "", serial: 0, layer: "", ancestors: ["beta"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeBeta", state, value, item.target, item.serial); return item; } };
const ExposeGamma: ExposeRecord = { tag: "gamma", code: "gamma:static", name: "ExposeGamma", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const item: ExposeItem = { tag: "gamma", value: undefined, target: "", serial: 0, layer: "", ancestors: ["gamma"] }; item.value = value; item.target = target.name; item.serial = ++state.count; state.made.push(item); state.log.push("construct", "ExposeGamma", state, value, item.target, item.serial); return item; } };
function layer(Base: ExposeRecord, marker: string): ExposeRecord { return { tag: "layer-" + marker, code: marker + ":static", name: "ExposeLayer", factory(state: ExposeState, value: ExposeValue, target: ExposeRecord): ExposeItem { const item = Base.factory(state, value, target); item.layer = marker; item.ancestors.push("layer-" + marker); state.log.push("construct", "ExposeLayer", state, value, item.target, item.layer); return item; } }; }
const LayerAlpha = layer(ExposeAlpha, "alpha"), LayerBeta = layer(ExposeBeta, "beta"), LayerGamma = layer(ExposeGamma, "gamma");
const allClasses: [ExposeRecord, string][] = [[ExposeAlpha, "alpha"], [ExposeBeta, "beta"], [ExposeGamma, "gamma"], [LayerAlpha, "layer-alpha"], [LayerBeta, "layer-beta"], [LayerGamma, "layer-gamma"]];
const choices: [ExposeRecord, string, string][] = [[LayerAlpha, "ExposeLayer", "alpha"], [LayerBeta, "ExposeLayer", "beta"], [LayerGamma, "ExposeLayer", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const baseName = tag === "alpha" ? "ExposeAlpha" : tag === "beta" ? "ExposeBeta" : "ExposeGamma";
  const first = Ctor.factory(state, input, Ctor), second = Ctor.factory(state, input, Ctor);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const name = Ctor.name; state.log.push("name", name); assert.sameValue(Object.is(name, label), true); assert.sameValue(typeof name, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    checks.push([item.layer, tag]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateTag] of allClasses) assert.sameValue(item.ancestors.includes(Candidate.tag), candidateTag === tag || candidateTag === "layer-" + tag, candidateTag);
  }
  assert.compareArray(state.log, ["construct", baseName, state, input, label, 1, "construct", "ExposeLayer", state, input, label, tag, "construct", baseName, state, input, label, 2, "construct", "ExposeLayer", state, input, label, tag, "static", label, tag + ":static", "name", label]);
}
