/*---
description: Control for keys-map-string-number-parameter; one Map<number | string, number> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/keys-map-string-number-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Map<number | string, number>, key: number | string, value: number): void { target.set(key, value); }
function check(n: number): void {
  const contents = new Map<number | string, number>();
  const text: string = String(n);
  write(contents, n, n + 10);
  write(contents, text, n + 20);
  assert.sameValue(contents.delete(n), true);
  write(contents, n, n + 30);
  const keys: unknown[] = [];
  const types: string[] = [];
  const values: unknown[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
    const value = contents.get(key);
    assert.sameValue(typeof value, "number"); values.push(value);
  }
  assert.compareArray(keys, [text, n]);
  assert.compareArray(types, ["string", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.compareArray(values, [n + 20, n + 30]);
  assert.sameValue(contents.has(n), true);
  assert.sameValue(contents.get(n), n + 30);
}
for (const n of [-3, 1, 7]) check(n);
