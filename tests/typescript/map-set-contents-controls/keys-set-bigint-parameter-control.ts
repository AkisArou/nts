/*---
description: Control for keys-set-bigint-parameter; one Set<bigint | number> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-bigint, ts-unions, ts-numbers]
---*/
// Paired case: ../map-set-contents/keys-set-bigint-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Set<bigint | number>, key: bigint | number): void { target.add(key); }
function check(n: bigint): void {
  const contents = new Set<bigint | number>();
  const high: bigint = n << 64n;
  const both: bigint = high | n;
  const numeric: number = Number(n);
  write(contents, n);
  write(contents, high);
  write(contents, both);
  write(contents, numeric);
  write(contents, high);
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [n, high, both, numeric]);
  assert.compareArray(types, ["bigint", "bigint", "bigint", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(contents.has(0n), false);
}
for (const n of [1n, 2n, 17n]) check(n);
