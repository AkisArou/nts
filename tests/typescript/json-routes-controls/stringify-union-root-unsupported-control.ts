/*---
description: Control for stringify-union-root-unsupported; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-arrays, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-typeof-operator]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
type JsonUnsupportedRoot = undefined | (() => number) | symbol;
interface JsonRootRecord { value: JsonUnsupportedRoot; }
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const roots: JsonUnsupportedRoot[] = [undefined, () => { calls++; return n; }, Symbol("root:" + n)];
  for (const root of roots) {
    const holder = { value: root };
    const result = JSON.stringify(holder.value);
    assert.sameValue(result, undefined);
    assert.sameValue(typeof result, "undefined");
    assert.sameValue(calls, 0);
  }
}
