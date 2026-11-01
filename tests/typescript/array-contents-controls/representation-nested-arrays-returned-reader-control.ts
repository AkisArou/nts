/*---
description: Control for representation-nested-arrays-returned-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-numbers]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
function read(values: number[][]): number[][] { return values; }
function check(n: number): void {
  const first: number[] = [n, -0], second: number[] = [NaN, n + 1];
  const values: number[][] = [];
  values.push(first, second, first);
  const reader = read(values);
  first.push(n + 0.5); second[1] = n + 2;
  assert.sameValue(reader.length, 3); assert.compareArray(reader, [first, second, first]);
  for (let i = 0; i < reader.length; i++) {
    const row = reader[i]; assert.sameValue(typeof row, "object"); assert.sameValue(Array.isArray(row), true);
    assert.compareArray(row, i === 1 ? [NaN, n + 2] : [n, -0, n + 0.5]);
    assert.sameValue(row.length, i === 1 ? 2 : 3);
    for (let j = 0; j < row.length; j++) {
      assert.sameValue(typeof row[j], "number");
      assert.sameValue(Object.hasOwn(row, j), true); assert.sameValue(j in row, true);
    }
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
}
for (const n of [-2, 0, 9]) check(n);
