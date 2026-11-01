/*---
description: Control for shapes-union-discriminated-object; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-objects, ts-numbers, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
type JsonChoice = { kind: "number"; value: number } | { kind: "text"; value: string };
function check(text: string, expected: number | string): void {
  const value: unknown = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("kind" in value) || !("value" in value)) throw new Error("choice");
  assert.compareArray(Object.keys(value), ["value", "kind"]);
  assert.sameValue(typeof value.kind, "string");
  assert.sameValue(value.kind, typeof expected === "number" ? "number" : "text");
  if (value.kind === "number") {
    assert.sameValue(typeof value.value, "number"); assert.sameValue(Object.is(value.value, expected), true);
  } else {
    assert.sameValue(typeof value.value, "string"); assert.sameValue(Object.is(value.value, expected), true);
  }
}
const inputs: [string, number | string][] = [
  ['{"value":-0,"kind":"number"}', -0], ['{"value":1.25e-2,"kind":"number"}', 0.0125],
  ['{"value":"first","kind":"text"}', "first"], ['{"value":"second","kind":"text"}', "second"],
];
for (const [text, expected] of inputs) check(text, expected);
