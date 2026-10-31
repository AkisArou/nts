/*---
description: Map object-identity keys retain equality, type and ordered identity across a typed writer parameter.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-objects]
---*/
// Write: Map<object, number> parameter; read: Map<Key, number>.keys and membership.
// Node preserves key identity and complete insertion order.
class Key {
  id: number;
  constructor(id: number) { this.id = id; }
}
function write(target: Map<object, number>, key: object, value: number): void { target.set(key, value); }
function check(n: number): void {
  const contents = new Map<Key, number>();
  const first = new Key(n);
  const second = new Key(n);
  const equalShape = new Key(n);
  write(contents, first, n);
  write(contents, second, n + 1);
  write(contents, first, n + 2);
  first.id = n + 100;
  const keys: unknown[] = [];
  const types: string[] = [];
  const values: unknown[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
    const value = contents.get(key);
    assert.sameValue(typeof value, "number"); values.push(value);
  }
  assert.compareArray(keys, [first, second]);
  assert.compareArray(types, ["object", "object"]);
  assert.sameValue(contents.size, keys.length);
  assert.compareArray(values, [n + 2, n + 1]);
  assert.sameValue(contents.has(first), true);
  assert.sameValue(contents.has(equalShape), false);
  assert.sameValue(contents.get(first), n + 2);
  assert.sameValue(contents.get(equalShape), undefined);
}
for (const n of [-3, 0, 7]) check(n);
