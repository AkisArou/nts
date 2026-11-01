/*---
description: Nonempty Map and Set values in an interface serialize as empty objects while sibling data remains visible.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-map-set, ts-numbers]
---*/
// Serialize interface-held Map and Set instances with real contents; node emits empty JSON objects for both.
interface JsonCollectionRecord { map: Map<string, number>; set: Set<number>; marker: number; }
for (const n of [-2, 0, 7]) {
  const value: JsonCollectionRecord = { map: new Map([["entry", n]]), set: new Set([n, n + 1]), marker: n };
  assert.sameValue(value.map.size, 1); assert.sameValue(value.set.size, 2);
  assert.sameValue(JSON.stringify(value), `{"map":{},"set":{},"marker":${n}}`);
}
