/*---
description: Control for stringify-interface-object-omissions; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-numbers, ts-strings]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
const JsonOmittedKey = Symbol("hidden");
interface JsonOmissionRecord {
  before: number; missing: undefined; callback: () => number; token: symbol; after: string; [JsonOmittedKey]: number;
}
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const value = { before: n, missing: undefined, callback: () => { calls++; return n; }, token: Symbol("value"), after: "kept", [JsonOmittedKey]: n + 1 };
  assert.sameValue(JSON.stringify(value), `{"before":${n},"after":"kept"}`);
  assert.compareArray(Object.keys(value), ["before", "missing", "callback", "token", "after"]);
  assert.sameValue(calls, 0);
}
