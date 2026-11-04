/*---
description: "Control: Omitted and undefined messages have no own property; empty and nonempty messages have an own property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-narrowing, ts-null-undefined, ts-numbers]
flags: [module]
---*/
// Control: Omitted and undefined messages have no own property; empty and nonempty messages have an own property. Route: a guarded Map.get value.
// Node prints: construction-message-map:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, true, true];
let literalIndex: number = 0;
const inputs: Error[] = [new Fault("SyntaxError", "", undefined, "SyntaxError"), new Fault("SyntaxError", "", undefined, "SyntaxError"), new Fault("SyntaxError", "", undefined, "SyntaxError"), new Fault("SyntaxError", "alpha", undefined, "SyntaxError: alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
const slots: Map<number, Error> = new Map();
for (let index = 0; index < inputs.length; index++) {
  slots.set(index, inputs[index]);
  const selected = slots.get(index); if (selected === undefined) throw "missing error";
  const value: Error = selected;
  assert.sameValue(value.name, "SyntaxError");
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-message-map:ok");
