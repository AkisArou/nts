/*---
description: An interface whose declaration order differs from insertion order still serializes integer-like keys first and string keys in insertion order.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-numbers, ts-strings]
---*/
// Serialize through an interface with deliberately reordered declarations; node follows property ordering rather than type-member order.
interface JsonOrderedRecord { alpha: boolean; "2": string; beta: number; "10": number; }
for (const n of [-2, 0, 7]) {
  const value: JsonOrderedRecord = { "10": n, beta: n + 1, "2": "two", alpha: false };
  assert.compareArray(Object.keys(value), ["2", "10", "beta", "alpha"]);
  assert.sameValue(JSON.stringify(value), `{"2":"two","10":${n},"beta":${n + 1},"alpha":false}`);
}
