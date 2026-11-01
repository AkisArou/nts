/*---
description: Control for shapes-number-array; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-arrays, ts-numbers, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
function check(text: string, expected: number[]): void {
  const value: unknown = JSON.parse(text);
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
