/*---
description: A non-null optional-field claim crosses a declared string return while absent and null values remain unchanged. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-interfaces, ts-optional-properties, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-null-undefined, ts-unions, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// An optional-field non-null claim crosses a declared string return; node preserves undefined, null, the empty string and live text. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface OptionalText { value?: string | null; }
function readText(input: OptionalText): string | null | undefined { return input.value; }
const rows: [OptionalText, string | null | undefined][] = [
  [{}, undefined], [{ value: undefined }, undefined], [{ value: null }, null],
  [{ value: "" }, ""], [{ value: "kept" }, "kept"]
];
for (const [input, expected] of rows) {
  const value = readText(input);
  same(value, expected);
  if (typeof expected === "string") same(String.prototype.valueOf.call(value), expected);
  else assert.throws(TypeError, () => String.prototype.valueOf.call(value));
}
