/*---
description: "Map grouping visits array holes as undefined through a captured readonly array route. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-readonly, ts-closures, ts-instanceof, ts-conversions]
---*/
// Map.groupBy receives a readonly array captured by a closure; node calls the callback for every iterator position, groups undefined holes, and leaves the sparse source unchanged. The control spells out the same steps.
const log: string[] = [];
let selected: readonly (number | undefined)[] = [];
function choose(value: number | undefined, index: number): number | undefined { log.push("callback:" + index + ":" + String(value)); return value; }
function apply(): Map<number | undefined, (number | undefined)[]> { log.push("apply"); const items = selected, callback = choose;
  const result = new Map<number | undefined, (number | undefined)[]>(); let index = 0;
  for (const value of items) { const key = callback(value, index++), bucket = result.get(key); if (bucket === undefined) result.set(key, [value]); else bucket.push(value); }
  return result;
}
for (const offset of [2, 10]) {
  const items: (number | undefined)[] = [offset, , offset + 1, , offset]; selected = items;
  log.length = 0; const result = apply(), first = result.get(offset), missing = result.get(undefined), last = result.get(offset + 1);
  assert.compareArray(log, ["apply", "callback:0:" + offset, "callback:1:undefined", "callback:2:" + (offset + 1), "callback:3:undefined", "callback:4:" + offset]);
  if (first === undefined || missing === undefined || last === undefined) throw new Test262Error("missing group");
  assert.compareArray([...result.keys()], [offset, undefined, offset + 1]); assert.sameValue(result.size, 3);
  assert.compareArray(first, [offset, offset]); assert.compareArray(missing, [undefined, undefined]); assert.compareArray(last, [offset + 1]);
  assert.sameValue(first === items, false); assert.compareArray(Object.keys(items), ["0", "2", "4"]); assert.sameValue(items.length, 5);
  assert.compareArray([...items], [offset, undefined, offset + 1, undefined, offset]); assert.sameValue(result instanceof Map, true);
}
