/*---
description: Control for keys-set-nan-parameter; one Set<number | string> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/keys-set-nan-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Set<number | string>, key: number | string): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<number | string>();
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
