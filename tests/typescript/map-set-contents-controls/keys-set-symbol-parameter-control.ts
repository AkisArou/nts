/*---
description: Control for keys-set-symbol-parameter; one Set<symbol | string> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-symbols, ts-unions, ts-strings]
---*/
// Paired case: ../map-set-contents/keys-set-symbol-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Set<symbol | string>, key: symbol | string): void { target.add(key); }
function check(n: number): void {
  const contents = new Set<symbol | string>();
  const label: string = "key:" + n;
  const first: symbol = Symbol(label);
  const second: symbol = Symbol(label);
  const shared: symbol = Symbol.for(label);
  write(contents, first);
  write(contents, second);
  write(contents, shared);
  write(contents, Symbol.for(label));
  write(contents, label);
  const keys: unknown[] = [];
  const types: string[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
  }
  assert.compareArray(keys, [first, second, shared, label]);
  assert.compareArray(types, ["symbol", "symbol", "symbol", "string"]);
  assert.sameValue(contents.size, keys.length);
  assert.sameValue(contents.has(Symbol(label)), false);
}
for (const n of [-3, 0, 7]) check(n);
