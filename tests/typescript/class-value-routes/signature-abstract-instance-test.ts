/*---
description: An abstract construct-signature view retains constructor identity for metadata and instanceof after concrete construction.
features: [ts-class-value-route-signatures, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-abstract, ts-closures]
---*/
// Route: an abstract new()=>SigItem view holds Alpha, Beta or Gamma; node retains its name and instanceof identity while its concrete view constructs.
type SigValue = number | string | undefined | { id: number };
interface SigItem { tag: string; value: SigValue; target: string; serial: number; }
interface SigState { log: unknown[]; made: SigItem[]; count: number; }
const identity = { id: 17 }; const inputs: SigValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
for (const input of inputs) {
const state: SigState = { log: [], made: [], count: 0 };
type SigConstructor = (new () => SigItem) & { readonly code: string; readonly name: string };
class SigAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor() { this.value = input; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigAlpha", this.target, this.serial); } }
class SigBeta { static code: string = "beta:static"; tag: string = "beta"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor() { this.value = input; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigBeta", this.target, this.serial); } }
class SigGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: SigValue = undefined; target: string = ""; serial: number = 0; constructor() { this.value = input; this.target = new.target.name; this.serial = ++state.count; state.made.push(this); state.log.push("construct", "SigGamma", this.target, this.serial); } }
type SigAbstract = (abstract new () => SigItem) & { readonly name: string };
function construct(Ctor: new () => SigItem): SigItem { return new Ctor(); }
const choices: [SigConstructor, string, string][] = [[SigAlpha, "SigAlpha", "alpha"], [SigBeta, "SigBeta", "beta"], [SigGamma, "SigGamma", "gamma"]];
for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const view: SigAbstract = Ctor;
  const first: SigItem = construct(Ctor), second: SigItem = construct(Ctor);
  const code = Ctor.code; state.log.push("static", label, code);
  assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const exposed = view.name; state.log.push("abstract.name", exposed); assert.sameValue(Object.is(exposed, label), true); assert.sameValue(typeof exposed, "string");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [SigItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
    assert.sameValue(item instanceof view, true);
  }
  assert.compareArray(state.log, ["construct", label, label, 1, "construct", label, label, 2, "static", label, tag + ":static", "abstract.name", label]);
}
}
