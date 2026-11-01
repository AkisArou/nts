/*---
description: A numeric array annotation preserves mixed integer, fractional and exponent values in every position.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-arrays, ts-numbers, ts-strings, ts-tuples]
---*/
// Parse matching number arrays into number[]; node retains all values, signs and element-key order, including an empty array.
function check(text: string, expected: number[]): void {
  const value: number[] = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (!Array.isArray(value)) throw new Error("numbers");
  const values: unknown[] = value;
  assert.sameValue(values.length, expected.length);
  const keys: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    keys.push(String(i));
    assert.sameValue(typeof values[i], "number"); assert.sameValue(Object.is(values[i], expected[i]), true);
  }
  assert.compareArray(Object.keys(values), keys);
}
const inputs: [string, number[]][] = [
  ["[-0,1,1.25,2e3]", [-0, 1, 1.25, 2000]],
  ["[9007199254740993,-9007199254740993,-0.0]", [9007199254740992, -9007199254740992, -0]],
  ["[-2.5e-3,0,5e-324]", [-0.0025, 0, 5e-324]], ["[]", []],
];
for (const [text, expected] of inputs) check(text, expected);
