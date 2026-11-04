/*---
description: "Explicit super forwarding keeps undefined and object causes own and preserves both tuple member layouts through a readonly subclass tuple."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-unknown, ts-numbers]
flags: [module]
---*/
// Explicit super forwarding keeps undefined and object causes own and preserves both tuple member layouts; route: a readonly subclass tuple.
// Node prints: brands-super-cause-readonly-tuple:ok
let keyNext: number = 0, deepNext: number = 0;
class Fault {
  name: string = "Error"; message: string; cause: unknown; code: number = 1; label: string = "child"; text: string;
  constructor(message: string, cause: unknown) { this.message = message; this.cause = cause; const texts: { [key: string]: string } = {"first": "Error: first", "second": "Error: second"}; this.text = texts[message]; }
  toString(): string { return this.text; }
}
function literalKeys(_value: unknown): string[] { const rows: string[][] = [["code"], ["code", "label"]]; return rows[keyNext++]; }
function literalDeep(value: unknown): value is Fault { const answers: boolean[] = [false, true]; return answers[deepNext++]; }
type FirstFault = Fault; const FirstFault = Fault;
type DeepFault = Fault; const DeepFault = Fault;
const reason: { id: number } = { id: 6 };
const values: readonly [FirstFault, DeepFault] = [new FirstFault("first", undefined), new DeepFault("second", reason)];
const reasons: readonly unknown[] = [undefined, reason];
const texts: readonly string[] = ["Error: first", "Error: second"];
const keys: readonly (readonly string[])[] = [["code"], ["code", "label"]];
assert.sameValue(values[1].label, "child");
for (let index = 0; index < values.length; index++) {
  const value = values[index];
  assert.sameValue(value.cause, reasons[index]); assert.sameValue(value.code, 1);
  assert.sameValue(true, true); assert.sameValue(true, true);
  assert.compareArray(literalKeys(value), keys[index]);
  assert.compareArray([true, literalDeep(value), true, true], [true, index === 1, true, true]);
  assert.sameValue(value.text, texts[index]);
}
console.log("brands-super-cause-readonly-tuple:ok");
