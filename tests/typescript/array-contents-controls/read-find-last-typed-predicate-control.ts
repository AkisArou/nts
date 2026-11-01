/*---
description: Control for read-find-last-typed-predicate; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-arrow-functions]
---*/
// Paired case: ../array-contents/read-find-last-typed-predicate.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  for (const sought of [text, "absent:" + text]) {
    const seen: unknown[] = [], types: string[] = [], indices: number[] = [];
    const result = xs.findLast((value, index, array) => {
      assert.sameValue(array, xs);
      assert.sameValue(Object.hasOwn(array, index), index !== 4); assert.sameValue(index in array, index !== 4);
      seen.push(value); types.push(typeof value); indices.push(index);
      return typeof value === "string" && String(value) === sought;
    });
    const hit = sought === text;
    assert.sameValue<unknown>(result, hit ? text : undefined);
    assert.sameValue(typeof result, hit ? "string" : "undefined");
    assert.compareArray(seen, hit ? [undefined, undefined, text] : [undefined, undefined, text, NaN, -0, n + 1]);
    assert.compareArray(types, hit ? ["undefined", "undefined", "string"] : ["undefined", "undefined", "string", "number", "number", "number"]);
    assert.compareArray(indices, hit ? [5, 4, 3] : [5, 4, 3, 2, 1, 0]);
  }
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
