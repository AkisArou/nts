/*---
description: An interface-typed object drops undefined, function and symbol values plus a symbol-keyed property while preserving the remaining field order.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-numbers, ts-strings]
---*/
// Serialize an interface-held object with unsupported values; node omits them without calling the function.
const JsonOmittedKey = Symbol("hidden");
interface JsonOmissionRecord {
  before: number; missing: undefined; callback: () => number; token: symbol; after: string; [JsonOmittedKey]: number;
}
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const value: JsonOmissionRecord = { before: n, missing: undefined, callback: () => { calls++; return n; }, token: Symbol("value"), after: "kept", [JsonOmittedKey]: n + 1 };
  assert.sameValue(JSON.stringify(value), `{"before":${n},"after":"kept"}`);
  assert.compareArray(Object.keys(value), ["before", "missing", "callback", "token", "after"]);
  assert.sameValue(calls, 0);
}
