/*---
description: A primitive union annotation preserves matching number, string, boolean and null roots.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-tuples]
---*/
// Parse matching primitive JSON into a union; node preserves runtime kinds, null and the sign of numeric zero.
type JsonAtom = number | string | boolean | null;
function check(text: string, expected: JsonAtom): void {
  const value: JsonAtom = JSON.parse(text);
  if (value !== null && typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") throw new Error("atom");
  assert.sameValue(typeof value, typeof expected); assert.sameValue(Object.is(value, expected), true);
  if (typeof value === "string") { assert.sameValue(value.length, 4); assert.compareArray(Object.keys(value), ["0", "1", "2", "3"]); }
}
const inputs: [string, JsonAtom][] = [
  ["-0", -0], ["1.25e2", 125], ['"text"', "text"], ['"word"', "word"],
  ["true", true], ["false", false], ["null", null],
];
for (const [text, expected] of inputs) check(text, expected);
