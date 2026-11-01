/*---
description: Control for shapes-tuple-root; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-arrays, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
type JsonTuple = [number, string, boolean, null];
function check(text: string, number: number, label: string, enabled: boolean): void {
  const value: unknown = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (!Array.isArray(value)) throw new Error("tuple");
  const values: unknown[] = value;
  assert.sameValue(values.length, 4); assert.compareArray(Object.keys(values), ["0", "1", "2", "3"]);
  assert.sameValue(typeof values[0], "number"); assert.sameValue(Object.is(values[0], number), true);
  assert.sameValue(typeof values[1], "string"); assert.sameValue(values[1], label);
  assert.sameValue(typeof values[2], "boolean"); assert.sameValue(values[2], enabled);
  assert.sameValue(typeof values[3], "object"); assert.sameValue(values[3], null);
}
const inputs: [string, number, string, boolean][] = [
  ['[-0,"first",true,null]', -0, "first", true],
  ['[1.25e2,"second",false,null]', 125, "second", false],
  ['[9007199254740993,"third",true,null]', 9007199254740992, "third", true],
];
for (const [text, number, label, enabled] of inputs) check(text, number, label, enabled);
