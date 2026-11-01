/*---
description: InstanceType holds results returned through a selected construct-signature value.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-utility-types]
---*/
// Route: the result is declared InstanceType<SigConstructor> after construction through Alpha, Beta or Gamma; node preserves identity and fields.
type SigValue = number | string | undefined | { id: number };
interface SigItem { tag: string; value: SigValue; target: string; serial: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const identity = { id: 17 }; const inputs: SigValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
type SigConstructor = (new (state: SigState, value: SigValue) => SigItem) & { readonly code: string; readonly name: string };
class SigAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor(state: SigState, value: SigValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigAlpha", state, value, this.target, this.serial); } }
class SigBeta { static code: string = "beta:static"; tag: string = "beta"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor(state: SigState, value: SigValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigBeta", state, value, this.target, this.serial); } }
class SigGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor(state: SigState, value: SigValue) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigGamma", state, value, this.target, this.serial); } }
function construct(Ctor: SigConstructor, state: SigState, value: SigValue): InstanceType<SigConstructor> { return new Ctor(state, value); }
const choices: [SigConstructor, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
const state: SigState = { log: [], made: [], count: 0 };
for (const input of inputs) {
for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first: InstanceType<SigConstructor> = construct(Ctor, state, input), second: InstanceType<SigConstructor> = construct(Ctor, state, input);
  const code = Ctor.code; state.log.push("static", label, code);
  assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [SigItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, label, 1, "construct", label, state, input, label, 2, "static", label, tag + ":static"]);
}
}
