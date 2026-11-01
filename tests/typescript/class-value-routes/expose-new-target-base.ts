/*---
description: A base constructor sees the selected class value as new.target for itself and three subclasses.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-inheritance]
---*/
// Route: a construct-signature list holds the base and three subclasses; each super call preserves the selected new.target and returns a fresh instance with the right ancestry.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
type ExposeCtor = (new (state: ExposeState, value: ExposeValue) => ExposeItem) & { readonly code: string; readonly name: string;  };
class ExposeRoot { static code: string = "root:static"; tag: string = "root"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; constructor(state: ExposeState, value: ExposeValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "ExposeRoot", state, value, this.target, this.serial); } }
class ExposeAlpha extends ExposeRoot { static override code: string = "alpha:static"; override tag: string = "alpha"; constructor(state: ExposeState, value: ExposeValue) { super(state, value); state.log.push("construct", "ExposeAlpha", state, value, new.target.name, this.serial); } }
class ExposeBeta extends ExposeRoot { static override code: string = "beta:static"; override tag: string = "beta"; constructor(state: ExposeState, value: ExposeValue) { super(state, value); state.log.push("construct", "ExposeBeta", state, value, new.target.name, this.serial); } }
class ExposeGamma extends ExposeRoot { static override code: string = "gamma:static"; override tag: string = "gamma"; constructor(state: ExposeState, value: ExposeValue) { super(state, value); state.log.push("construct", "ExposeGamma", state, value, new.target.name, this.serial); } }
const choices: [ExposeCtor, string, string][] = [[ExposeRoot, "ExposeRoot", "root"], [ExposeAlpha, "ExposeAlpha", "alpha"], [ExposeBeta, "ExposeBeta", "beta"], [ExposeGamma, "ExposeGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first = new Ctor(state, input), second = new Ctor(state, input);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const name = Ctor.name; state.log.push("name", name); assert.sameValue(Object.is(name, label), true); assert.sameValue(typeof name, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, candidateTag === "root" || tag === candidateTag, candidateName);
  }
  const expected: unknown[] = ["construct", "ExposeRoot", state, input, label, 1]; if (tag !== "root") expected.push("construct", label, state, input, label, 1);
  expected.push("construct", "ExposeRoot", state, input, label, 2); if (tag !== "root") expected.push("construct", label, state, input, label, 2);
  expected.push("static", label, tag + ":static", "name", label); assert.compareArray(state.log, expected);
}
