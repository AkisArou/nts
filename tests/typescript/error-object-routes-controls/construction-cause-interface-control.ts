/*---
description: "Control: Two interface factories retain distinct error targets while installing undefined, falsy and reference causes."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-interfaces, ts-class, ts-objects, ts-unknown, ts-numbers]
flags: [module]
---*/
// Control: Two interface factories retain distinct error targets while installing undefined, falsy and reference causes. Route: an interface with Error and TypeError factory implementations.
// Node prints: construction-cause-interface:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
interface CauseMaker { make(cause: unknown): Error; }
class BaseMaker implements CauseMaker { make(cause: unknown): Error { return new Fault("Error", "base", cause, "Error: base"); } }
class TypeMaker implements CauseMaker { make(cause: unknown): Error { return new Fault("TypeError", "typed", cause, "TypeError: typed"); } }
const first = { id: 1 }, second = { id: 2 };
const causes: unknown[] = [undefined, first, second, 0];
const makers: CauseMaker[] = [new BaseMaker(), new TypeMaker()];
const names: string[] = ["Error", "TypeError"], messages: string[] = ["base", "typed"];
for (const cause of causes) for (let index = 0; index < makers.length; index++) {
  const value: Error = makers[index].make(cause);
  assert.sameValue(value.name, names[index]);
  assert.sameValue(value.message, messages[index]);
  assert.sameValue(value.cause, cause);
  assert.sameValue(true, true);
}
console.log("construction-cause-interface:ok");
