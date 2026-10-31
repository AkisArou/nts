/*---
description: Map signed-zero keys retain equality, type and ordered identity across a typed writer parameter.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Write: Map<number | string, number> parameter; read: Map<number, number>.keys and membership.
// Node preserves key identity and complete insertion order.
function write(target: Map<number | string, number>, key: number | string, value: number): void { target.set(key, value); }
function check(n: number): void {
  const contents = new Map<number, number>();
  const negative: number = -0 * n;
  const positive: number = n - n;
  write(contents, negative, n);
  write(contents, positive, n + 1);
  write(contents, "0", n + 2);
  write(contents, n, n + 3);
  const keys: unknown[] = [];
  const types: string[] = [];
  const values: unknown[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
    const value = contents.get(key);
    assert.sameValue(typeof value, "number"); values.push(value);
  }
  assert.compareArray(keys, [0, "0", n]);
  assert.compareArray(types, ["number", "string", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.compareArray(values, [n + 1, n + 2, n + 3]);
  assert.sameValue(keys[0], 0);
  assert.notSameValue(keys[0], -0);
  assert.sameValue(contents.has(-0), true);
  assert.sameValue(contents.has(0), true);
  assert.sameValue(contents.get(-0), n + 1);
}
for (const n of [1, 3, 7]) check(n);
