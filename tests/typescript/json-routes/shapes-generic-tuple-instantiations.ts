/*---
description: A generic tuple parse helper preserves its payload kind and signed numeric tail across two instantiations.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-generics, ts-tuples, ts-arrays, ts-unions, ts-numbers, ts-strings]
---*/
// Parse matching tuples through number and string generic instantiations; node preserves both positions and index order.
function readPair<T>(text: string): [T, number] {
  const value: [T, number] = JSON.parse(text); return value;
}
function check(text: string, expected: number | string, tail: number): void {
  const value = typeof expected === "number" ? readPair<number>(text) : readPair<string>(text);
  assert.sameValue(typeof value, "object");
  if (!Array.isArray(value)) throw new Error("pair");
  const values: unknown[] = value;
  assert.sameValue(values.length, 2); assert.compareArray(Object.keys(values), ["0", "1"]);
  assert.sameValue(typeof values[0], typeof expected); assert.sameValue(Object.is(values[0], expected), true);
  assert.sameValue(typeof values[1], "number"); assert.sameValue(Object.is(values[1], tail), true);
}
const inputs: [string, number | string, number][] = [
  ['[-0,1.25]', -0, 1.25], ['[9007199254740993,-0]', 9007199254740992, -0],
  ['["first",2e3]', "first", 2000], ['["second",-0]', "second", -0],
];
for (const [text, expected, tail] of inputs) check(text, expected, tail);
