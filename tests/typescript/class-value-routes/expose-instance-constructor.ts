/*---
description: Instances built through a constructor type retain the exact selected constructor and its name.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static]
---*/
// Route: three classes enter a typed constructor list; each instance.constructor is its selected class value, after two fresh constructions.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
type ExposeCtor = (new (state: ExposeState, value: ExposeValue) => ExposeItem) & { readonly code: string; readonly name: string;  };
class ExposeAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; constructor(state: ExposeState, value: ExposeValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "ExposeAlpha", state, value, this.target, this.serial); } }
class ExposeBeta { static code: string = "beta:static"; tag: string = "beta"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; constructor(state: ExposeState, value: ExposeValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "ExposeBeta", state, value, this.target, this.serial); } }
class ExposeGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; constructor(state: ExposeState, value: ExposeValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "ExposeGamma", state, value, this.target, this.serial); } }
const choices: [ExposeCtor, string, string][] = [[ExposeAlpha, "ExposeAlpha", "alpha"], [ExposeBeta, "ExposeBeta", "beta"], [ExposeGamma, "ExposeGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first = new Ctor(state, input), second = new Ctor(state, input);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    const exposed = item.constructor; state.log.push("constructor", label, exposed); assert.sameValue(Object.is(exposed, Ctor), true);
    const name = exposed.name; state.log.push("constructor.name", label, name); checks.push([name, label]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, label, 1, "construct", label, state, input, label, 2, "static", label, tag + ":static", "constructor", label, Ctor, "constructor.name", label, label, "constructor", label, Ctor, "constructor.name", label, label]);
}
