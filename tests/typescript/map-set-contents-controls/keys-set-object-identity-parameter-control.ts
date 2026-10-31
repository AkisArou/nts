/*---
description: Control for keys-set-object-identity-parameter; one Set<object> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-objects]
---*/
// Paired case: ../map-set-contents/keys-set-object-identity-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
class Key {
  id: number;
  constructor(id: number) { this.id = id; }
}
function write(target: Set<object>, key: object): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<object>();
  const first = new Key(n);
  const second = new Key(n);
  const equalShape = new Key(n);
  write(contents, first);
  write(contents, second);
  write(contents, first);
  first.id = n + 100;
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [first, second]);
  assert.compareArray(types, ["object", "object"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(contents.has(first), true);
  assert.sameValue(contents.has(equalShape), false);
}
for (const n of [-3, 0, 7]) check(n);
