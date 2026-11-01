/*---
description: Unsupported root values read from a union-typed interface field produce undefined rather than JSON text.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-arrays, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-typeof-operator]
---*/
// Read the root through an interface field containing undefined, a function or a symbol; node produces undefined and never invokes the function.
type JsonUnsupportedRoot = undefined | (() => number) | symbol;
interface JsonRootRecord { value: JsonUnsupportedRoot; }
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const roots: JsonUnsupportedRoot[] = [undefined, () => { calls++; return n; }, Symbol("root:" + n)];
  for (const root of roots) {
    const holder: JsonRootRecord = { value: root };
    const result = JSON.stringify(holder.value);
    assert.sameValue(result, undefined);
    assert.sameValue(typeof result, "undefined");
    assert.sameValue(calls, 0);
  }
}
