/*---
description: Constructor lengths distinguish optional, default and rest tails through stored constructor values.
features: [ts-class-value-route-exposure, ts-class, ts-construct-signatures, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects, ts-new-target, ts-instanceof, ts-static, ts-optional-parameters, ts-default-parameters, ts-rest-parameters]
---*/
// Route: three classes share a construct signature but declare optional, default or rest tails; node reports lengths 3, 2 and 2 while omitted and supplied calls retain their arguments.
type ExposeValue = number | string | undefined | { id: number };
interface ExposeItem { tag: string; value: ExposeValue; target: string; serial: number; mark: number | undefined; }
interface ExposeState { log: unknown[]; made: ExposeItem[]; count: number; }
const identity = { id: 19 }; const inputs: ExposeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
type ExposeCtor = (new (state: ExposeState, value: ExposeValue, mark?: number) => ExposeItem) & { readonly code: string; readonly name: string; readonly length: number; };
class ExposeAlpha { static code: string = "alpha:static"; tag: string = "alpha"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; mark: number | undefined = undefined; constructor(state: ExposeState, value: ExposeValue, mark?: number) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = mark; state.made.push(this); state.log.push("construct", "ExposeAlpha", state, value, this.mark, arguments.length, this.target, this.serial); } }
class ExposeBeta { static code: string = "beta:static"; tag: string = "beta"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; mark: number | undefined = undefined; constructor(state: ExposeState, value: ExposeValue, mark: number = 7) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = mark; state.made.push(this); state.log.push("construct", "ExposeBeta", state, value, this.mark, arguments.length, this.target, this.serial); } }
class ExposeGamma { static code: string = "gamma:static"; tag: string = "gamma"; value: ExposeValue = undefined; target: string = ""; serial: number = 0; mark: number | undefined = undefined; constructor(state: ExposeState, value: ExposeValue, ...marks: (number | undefined)[]) { this.value = value; this.target = new.target.name; this.serial = ++state.count; this.mark = marks[0]; state.made.push(this); state.log.push("construct", "ExposeGamma", state, value, this.mark, arguments.length, this.target, this.serial); } }
const choices: [ExposeCtor, string, string][] = [[ExposeAlpha, "ExposeAlpha", "alpha"], [ExposeBeta, "ExposeBeta", "beta"], [ExposeGamma, "ExposeGamma", "gamma"]];
const state: ExposeState = { log: [], made: [], count: 0 };
for (const input of inputs) for (const [Ctor, label, tag] of choices) {
  state.log.length = 0; state.made.length = 0; state.count = 0;
  const omitted: number | undefined = tag === "beta" ? 7 : undefined;
  const first = new Ctor(state, input), second = new Ctor(state, input, 9);
  const code = Ctor.code; state.log.push("static", label, code); assert.sameValue(Object.is(code, tag + ":static"), true); assert.sameValue(typeof code, "string");
  const length = Ctor.length; state.log.push("length", length); assert.sameValue(Object.is(length, tag === "alpha" ? 3 : 2), true); assert.sameValue(typeof length, "number");
  assert.sameValue(Object.is(first, second), false); assert.sameValue(state.count, 2); assert.sameValue(state.made.length, 2);
  const results: [ExposeItem, number][] = [[first, 1], [second, 2]];
  for (const [item, serial] of results) {
    const checks: [unknown, unknown][] = [[item, state.made[serial - 1]], [item.value, input], [item.tag, tag], [item.target, label], [item.serial, serial]];
    checks.push([item.mark, serial === 1 ? omitted : 9]);
    for (const [actual, wanted] of checks) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    for (const [Candidate, candidateName, candidateTag] of choices) assert.sameValue(item instanceof Candidate, tag === candidateTag, candidateName);
  }
  assert.compareArray(state.log, ["construct", label, state, input, omitted, 2, label, 1, "construct", label, state, input, 9, 3, label, 2, "static", label, tag + ":static", "length", tag === "alpha" ? 3 : 2]);
}
