/*---
description: Control for keys-map-symbol-parameter; one Map<symbol | string, number> declaration for writes and reads.
features: [ts-map-set-contents, ts-contents-keys, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-symbols, ts-unions, ts-strings]
---*/
// Paired case: ../map-set-contents/keys-map-symbol-parameter.ts.
// Only the allocation type becomes the writer type; operations and checks stay the same.
function write(target: Map<symbol | string, number>, key: symbol | string, value: number): void { target.set(key, value); }
function check(n: number): void {
  const contents = new Map<symbol | string, number>();
  const label: string = "key:" + n;
  const first: symbol = Symbol(label);
  const second: symbol = Symbol(label);
  const shared: symbol = Symbol.for(label);
  write(contents, first, n);
  write(contents, second, n + 1);
  write(contents, shared, n + 2);
  write(contents, Symbol.for(label), n + 3);
  write(contents, label, n + 4);
  const keys: unknown[] = [];
  const types: string[] = [];
  const values: unknown[] = [];
  for (const key of contents.keys()) {
    keys.push(key); types.push(typeof key);
    assert.sameValue(contents.has(key), true);
    const value = contents.get(key);
    assert.sameValue(typeof value, "number"); values.push(value);
  }
  assert.compareArray(keys, [first, second, shared, label]);
  assert.compareArray(types, ["symbol", "symbol", "symbol", "string"]);
  assert.sameValue(contents.size, keys.length);
  assert.compareArray(values, [n, n + 1, n + 3, n + 4]);
  assert.sameValue(contents.has(Symbol(label)), false);
  assert.sameValue(contents.get(Symbol.for(label)), n + 3);
}
for (const n of [-3, 0, 7]) check(n);
