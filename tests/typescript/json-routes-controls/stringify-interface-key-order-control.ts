/*---
description: Control for stringify-interface-key-order; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-numbers, ts-strings]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonOrderedRecord { alpha: boolean; "2": string; beta: number; "10": number; }
for (const n of [-2, 0, 7]) {
  const value = { "10": n, beta: n + 1, "2": "two", alpha: false };
  assert.compareArray(Object.keys(value), ["2", "10", "beta", "alpha"]);
  assert.sameValue(JSON.stringify(value), `{"2":"two","10":${n},"beta":${n + 1},"alpha":false}`);
}
