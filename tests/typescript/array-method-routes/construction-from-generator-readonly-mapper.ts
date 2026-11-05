/*---
description: "Array.from maps each yielded tuple value with its sequence index before later tuple writes."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-tuples, ts-generators, ts-unions, ts-strings, ts-unknown, ts-destructuring, ts-arrow-functions]
---*/

// Array.from maps each yielded tuple value with its sequence index before later tuple writes. Route: a readonly tuple parameter of a typed generator. Node prints construction-from-generator-readonly-mapper:ok.
function* produce(values: readonly [number, string]): Generator<number | string, void, unknown> {
  yield values[0]; yield values[1]; yield values[0]; yield values[1];
}
const rows: readonly [readonly [number, string], readonly string[]][] = [
  [[4, "x"], ["0:4", "1:x", "2:4", "3:x"]], [[-0, ""], ["0:0", "1:", "2:0", "3:"]], [[9, "end"], ["0:9", "1:end", "2:9", "3:end"]]
];
for (const [input, expected] of rows) {
  const source: [number, string] = [input[0], input[1]], iterator = produce(source);
  const result = Array.from(iterator, (value, index) => index + ":" + value);
  source[0] = 99; source[1] = "changed";
  assert.compareArray(result, expected);
}
console.log("construction-from-generator-readonly-mapper:ok");
