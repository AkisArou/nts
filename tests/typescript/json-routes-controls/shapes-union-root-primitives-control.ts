/*---
description: Control for shapes-union-root-primitives; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
type JsonAtom = number | string | boolean | null;
function check(text: string, expected: JsonAtom): void {
  const value: unknown = JSON.parse(text);
  if (value !== null && typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") throw new Error("atom");
  assert.sameValue(typeof value, typeof expected); assert.sameValue(Object.is(value, expected), true);
  if (typeof value === "string") { assert.sameValue(value.length, 4); assert.compareArray(Object.keys(value), ["0", "1", "2", "3"]); }
}
const inputs: [string, JsonAtom][] = [
  ["-0", -0], ["1.25e2", 125], ['"text"', "text"], ['"word"', "word"],
  ["true", true], ["false", false], ["null", null],
];
for (const [text, expected] of inputs) check(text, expected);
