/*---
description: Set signed-zero keys retain equality, type and ordered identity across a typed writer parameter.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Write: Set<number | string> parameter; read: Set<number>.keys and membership.
// Node preserves key identity and complete insertion order.
function write(target: Set<number | string>, key: number | string): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<number>();
  const negative: number = -0 * n;
  const positive: number = n - n;
  write(contents, negative);
  write(contents, positive);
  write(contents, "0");
  write(contents, n);
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [0, "0", n]);
  assert.compareArray(types, ["number", "string", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(keys[0], 0);
  assert.notSameValue(keys[0], -0);
  assert.sameValue(contents.has(-0), true);
  assert.sameValue(contents.has(0), true);
}
for (const n of [1, 3, 7]) check(n);
