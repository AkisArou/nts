/*---
description: find observes actual string contents and its exact callback traversal through a numeric array.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-arrow-functions]
---*/
// Write through a union alias; read with a find callback whose input type follows the narrow array; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: number[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  for (const sought of [text, "absent:" + text]) {
    const seen: unknown[] = [], types: string[] = [], indices: number[] = [];
    const result = xs.find((value, index, array) => {
      assert.sameValue(array, xs);
      assert.sameValue(Object.hasOwn(array, index), index !== 4); assert.sameValue(index in array, index !== 4);
      seen.push(value); types.push(typeof value); indices.push(index);
      return typeof value === "string" && String(value) === sought;
    });
    const hit = sought === text;
    assert.sameValue<unknown>(result, hit ? text : undefined);
    assert.sameValue(typeof result, hit ? "string" : "undefined");
    assert.compareArray(seen, hit ? [n + 1, -0, NaN, text] : [n + 1, -0, NaN, text, undefined, undefined]);
    assert.compareArray(types, hit ? ["number", "number", "number", "string"] : ["number", "number", "number", "string", "undefined", "undefined"]);
    assert.compareArray(indices, hit ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5]);
  }
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
