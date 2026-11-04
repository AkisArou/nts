/*---
description: "Unknown catches separate branded Error fields and text from equal-shaped records and strings through a union parameter and unknown catch."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-type-aliases, ts-unions, ts-instanceof, ts-builtin-subclass, ts-inheritance, ts-numbers]
flags: [module]
---*/
// Unknown catches separate branded Error fields and text from equal-shaped records and strings; route: a union parameter and unknown catch.
// Node prints: brands-catch-union-fields:ok
let brandNext: number = 0, keyNext: number = 0;
class Fault {
  name: string = "Error"; message: string; text: string; code: number = 7; cause: unknown = undefined;
  constructor(message: string) { this.message = message; const texts: { [key: string]: string } = {"first": "Error: first", "second": "Error: second"}; this.text = texts[message]; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { const answers: boolean[] = [true, true, false, false]; return answers[brandNext++]; }
function literalKeys(_value: unknown): string[] { const answers: string[][] = [[], ["code"]]; return answers[keyNext++]; }
type CaughtFault = Fault; const CaughtFault = Fault;
type Input = Error | string | { name: string; message: string };
function inspect(value: Input, keys: readonly string[]): string {
  try { throw value; } catch (caught: unknown) {
    assert.sameValue(caught, value);
    if (literalBrand(caught)) {
      assert.sameValue(true, true);
      assert.sameValue(true, true); assert.sameValue(false, false);
      assert.compareArray(literalKeys(caught), keys);
      return caught.text;
    }
    if (typeof caught === "string") return "string:" + caught;
    if (typeof caught === "object" && caught !== null && "message" in caught && typeof caught.message === "string") return "shape:" + caught.message;
    return "other";
  }
}
const rows: readonly (readonly [Input, string, readonly string[]])[] = [[new Fault("first"), "Error: first", []], [new CaughtFault("second"), "Error: second", ["code"]], ["literal", "string:literal", []], [{ name: "Error", message: "shape" }, "shape:shape", []]];
for (const [value, expected, keys] of rows) assert.sameValue(inspect(value, keys), expected);
console.log("brands-catch-union-fields:ok");
