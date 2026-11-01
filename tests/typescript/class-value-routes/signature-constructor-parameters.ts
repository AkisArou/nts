/*---
description: ConstructorParameters supplies complete argument tuples to three selected class values.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-utility-types, ts-tuples]
---*/
// Route: ConstructorParameters<SigConstructor> carries state, mixed payload and numeric marker into new Ctor; node preserves the full tuple.
type SigValue = number | string | undefined | { id: number };
interface SigItem { tag: string; value: SigValue; target: string; serial: number; mark: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const identity = { id: 17 }; const inputs: SigValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
type SigConstructor = (new (state: SigState, value: SigValue, mark: number) => SigItem) & { readonly code: string; readonly name: string };
class SigAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: SigValue = undefined; target: string = ""; serial: number = 0; mark: number = 0; constructor(state: SigState, value: SigValue, mark: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = mark; state.made.push(this); state.log.push("construct", "SigAlpha", state, value, mark, this.target, this.serial); } }
class SigBeta { static code: string = "beta:static"; tag: string = "beta"; value: SigValue = undefined; target: string = ""; serial: number = 0; mark: number = 0; constructor(state: SigState, value: SigValue, mark: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = mark; state.made.push(this); state.log.push("construct", "SigBeta", state, value, mark, this.target, this.serial); } }
class SigGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: SigValue = undefined; target: string = ""; serial: number = 0; mark: number = 0; constructor(state: SigState, value: SigValue, mark: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = mark; state.made.push(this); state.log.push("construct", "SigGamma", state, value, mark, this.target, this.serial); } }
type SigArgs = ConstructorParameters<SigConstructor>;
function construct(Ctor: SigConstructor, args: SigArgs): SigItem { return new Ctor(...args); }
const choices: [SigConstructor, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
const state: SigState = { log: [], made: [], count: 0 };
for (const input of inputs) {
for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const first: SigItem = construct(Ctor, [state, input, 17]), second: SigItem = construct(Ctor, [state, input, 29]);
  const code = Ctor.code; state.log.push("static", label, code);
  assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [SigItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    checks.push([item.mark, serial === 1 ? 17 : 29]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, 17, label, 1, "construct", label, state, input, 29, label, 2, "static", label, tag + ":static"]);
}
}
