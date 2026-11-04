/*---
description: "Unknown catches separate branded Error fields and text from equal-shaped records and strings through a union parameter and unknown catch."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-type-aliases, ts-unions, ts-instanceof, ts-builtin-subclass, ts-inheritance, ts-numbers]
flags: [module]
---*/
// Unknown catches separate branded Error fields and text from equal-shaped records and strings; route: a union parameter and unknown catch.
// Node prints: brands-catch-union-fields:ok
class CaughtFault extends Error { code: number = 7; }
type Input = Error | string | { name: string; message: string };
function inspect(value: Input, keys: readonly string[]): string {
  try { throw value; } catch (caught: unknown) {
    assert.sameValue(caught, value);
    if (Error.isError(caught)) {
      assert.sameValue(caught instanceof Error, true);
      assert.sameValue(Object.hasOwn(caught, "message"), true); assert.sameValue(Object.hasOwn(caught, "cause"), false);
      assert.compareArray(Object.keys(caught), keys);
      return String(caught);
    }
    if (typeof caught === "string") return "string:" + caught;
    if (typeof caught === "object" && caught !== null && "message" in caught && typeof caught.message === "string") return "shape:" + caught.message;
    return "other";
  }
}
const rows: readonly (readonly [Input, string, readonly string[]])[] = [[new Error("first"), "Error: first", []], [new CaughtFault("second"), "Error: second", ["code"]], ["literal", "string:literal", []], [{ name: "Error", message: "shape" }, "shape:shape", []]];
for (const [value, expected, keys] of rows) assert.sameValue(inspect(value, keys), expected);
console.log("brands-catch-union-fields:ok");
