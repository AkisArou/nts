/*---
description: A generic factory constrained only by a numeric constructor argument returns each selected class instance.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-generics, ts-closures]
---*/
// Route: construct<T>(new(number)=>T) receives Alpha, Beta and Gamma from a typed list; node preserves -0, NaN and wide numeric arguments.
function construct<T>(Ctor: new (value: number) => T, value: number): T { return new Ctor(value); }
interface SigItem { tag: string; value: number; target: string; serial: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const inputs: number[] = [0, -0, NaN, 0.5, 2147483648, Infinity];
for (const input of inputs) {
const state: SigState = { log: [], made: [], count: 0 };
type SigConstructor = (new (value: number) => SigItem) & { readonly code: string; readonly name: string };
class SigAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: number = 0; target: string = ""; serial: number = 0; constructor(value: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigAlpha", value, this.target, this.serial); } }
class SigBeta { static code: string = "beta:static"; tag: string = "beta"; value: number = 0; target: string = ""; serial: number = 0; constructor(value: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigBeta", value, this.target, this.serial); } }
class SigGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: number = 0; target: string = ""; serial: number = 0; constructor(value: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigGamma", value, this.target, this.serial); } }
const choices: [SigConstructor, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
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
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, input, label, 1, "construct", label, input, label, 2, "static", label, tag + ":static"]);
}
}
