/*---
description: Control for stringify-interface-map-set; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-map-set, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonCollectionRecord { map: Map<string, number>; set: Set<number>; marker: number; }
for (const n of [-2, 0, 7]) {
  const value = { map: new Map([["entry", n]]), set: new Set([n, n + 1]), marker: n };
  assert.sameValue(value.map.size, 1); assert.sameValue(value.set.size, 2);
  assert.sameValue(JSON.stringify(value), `{"map":{},"set":{},"marker":${n}}`);
}
