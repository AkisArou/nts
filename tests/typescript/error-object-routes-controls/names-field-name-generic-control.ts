/*---
description: "A name field is own and enumerable and controls inherited text conversion through a constrained describer at Named and Error."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-override, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-iteration]
flags: [module]
---*/
// A name field is own and enumerable and controls inherited text conversion; route: a constrained describer at Named and Error.
// Node prints: names-field-name-generic:ok
let faultIndex: number = 0;
class Fault {
  name: string = "Named"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["Named: m", "Named"][faultIndex++]; }
  toString(): string { return this.text; }
}
type Named = Fault; const Named = Fault;
function describe<E extends Fault>(error: E): [string, boolean, string[]] { return [error.text, true, ["name"]]; }
const first: Named = new Named("m"); const second: Fault = new Named("");
const answers: [string, boolean, string[]][] = [describe<Named>(first), describe<Fault>(second)];
for (let index = 0; index < answers.length; index++) {
  const [text, own, keys] = answers[index];
  assert.sameValue(text, ["Named: m", "Named"][index]); assert.sameValue(own, true); assert.compareArray(keys, ["name"]);
}
console.log("names-field-name-generic:ok");
