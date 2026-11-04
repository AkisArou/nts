/*---
description: "Object grouping converts numeric and string keys from an interface callback. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-interfaces, ts-readonly, ts-mapped-types, ts-utility-types]
---*/
// Object.groupBy crosses an interface callback field; node merges numeric/string keys, canonicalizes -0 to property 0, and calls once per item with the correct index. The control spells out the same steps.
const log: string[] = [];
interface Row { key: number | string; value: number; }
interface Route { items: readonly Row[]; select: (row: Row, index: number) => number | string; }
function apply(route: Route): Partial<Record<PropertyKey, Row[]>> { log.push("apply"); const items = route.items, callback = route.select;
  const result: Partial<Record<PropertyKey, Row[]>> = Object.create(null); let index = 0;
  for (const value of items) { const raw = callback(value, index++), key = typeof raw === "symbol" ? raw : String(raw); const bucket = result[key]; if (bucket === undefined) result[key] = [value]; else bucket.push(value); }
  return result;
}
for (const offset of [2, 10]) {
  const items: Row[] = [{ key: 1, value: offset }, { key: "1", value: offset + 1 }, { key: -0, value: offset + 2 }, { key: "0", value: offset + 3 }, { key: 2, value: offset + 4 }, { key: "2", value: offset + 5 }];
  const original = [...items];
  const route: Route = { items, select(row: Row, index: number): number | string { log.push("callback:" + index + ":" + row.value); return row.key; } };
  log.length = 0; const result = apply(route), zero = result[0], one = result[1], two = result[2];
  assert.compareArray(log, ["apply", "callback:0:" + offset, "callback:1:" + (offset + 1), "callback:2:" + (offset + 2), "callback:3:" + (offset + 3), "callback:4:" + (offset + 4), "callback:5:" + (offset + 5)]);
  if (zero === undefined || one === undefined || two === undefined) throw new Test262Error("missing group");
  assert.compareArray(Object.keys(result), ["0", "1", "2"]); assert.sameValue("valueOf" in result, false);
  assert.compareArray(zero, [items[2], items[3]]); assert.compareArray(one, [items[0], items[1]]); assert.compareArray(two, [items[4], items[5]]);
  assert.sameValue(one === items, false); assert.compareArray(items, original);
}
