/*---
description: Control for keys-set-string-number-parameter; one Set<number | string> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/keys-set-string-number-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Set<number | string>, key: number | string): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<number | string>();
  const text: string = String(n);
  write(contents, n);
  write(contents, text);
  assert.sameValue(contents.delete(n), true);
  write(contents, n);
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [text, n]);
  assert.compareArray(types, ["string", "number"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(contents.has(n), true);
}
for (const n of [-3, 1, 7]) check(n);
