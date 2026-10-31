/*---
description: Control for keys-map-bigint-parameter; one Map<bigint | number, number> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-bigint, ts-unions, ts-numbers]
---*/
// Paired case: ../map-set-contents/keys-map-bigint-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Map<bigint | number, number>, key: bigint | number, value: number): void { target.set(key, value); }
function check(n: bigint): void {
  const contents = new Map<bigint | number, number>();
  const high: bigint = n << 64n;
  const both: bigint = high | n;
  const numeric: number = Number(n);
  write(contents, n, 1);
  write(contents, high, 2);
  write(contents, both, 3);
  write(contents, numeric, 4);
  write(contents, high, 5);
  const keys: unknown[] = [];
  const types: string[] = [];
  const values: unknown[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
    const value = contents.get(key);
    assert.sameValue(typeof value, "number"); values.push(value);
  }
  assert.compareArray(keys, [n, high, both, numeric]);
  assert.compareArray(types, ["bigint", "bigint", "bigint", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.compareArray(values, [1, 5, 3, 4]);
  assert.sameValue(contents.has(0n), false);
  assert.sameValue(contents.get(high), 5);
  assert.sameValue(contents.get(0n), undefined);
}
for (const n of [1n, 2n, 17n]) check(n);
