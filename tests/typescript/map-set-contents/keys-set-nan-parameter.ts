/*---
description: Set nan keys retain equality, type and ordered identity across a typed writer parameter.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Write: Set<number | string> parameter; read: Set<number>.keys and membership.
// Node preserves key identity and complete insertion order.
function write(target: Set<number | string>, key: number | string): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<number>();
  write(contents, NaN);
  write(contents, Number("not-a-number"));
  write(contents, n);
  write(contents, "NaN");
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [NaN, n, "NaN"]);
  assert.compareArray(types, ["number", "number", "string"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(contents.has(NaN), true);
}
for (const n of [-3, 2, 9]) check(n);
