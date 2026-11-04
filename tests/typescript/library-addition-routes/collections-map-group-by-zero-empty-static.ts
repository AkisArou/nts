/*---
description: "Map grouping canonicalizes its zero key through a static callback field without changing elements."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-class, ts-class-fields, ts-static, ts-readonly, ts-conversions, ts-instanceof]
---*/
// Map.groupBy takes a callback from a static field; node canonicalizes the key -0 to +0 while preserving a grouped element -0, merges NaN keys, and never calls the callback for empty input.
const log: string[] = [];
class Route {
  static select: (value: number, index: number) => number = function(value: number, index: number): number { log.push("callback:" + index + ":" + (Object.is(value, -0) ? "-0" : String(value))); return value; };
  static apply(items: readonly number[]): Map<number, number[]> { log.push("apply"); const callback = Route.select;
    return Map.groupBy(items, callback);
  }
}
const inputs: number[][] = [[], [-0, 0, NaN, NaN, 1]];
for (const items of inputs) {
  const original = [...items]; log.length = 0; const result = Route.apply(items);
  assert.compareArray(log, items.length === 0 ? ["apply"] : ["apply", "callback:0:-0", "callback:1:0", "callback:2:NaN", "callback:3:NaN", "callback:4:1"]);
  assert.compareArray([...result.keys()], items.length === 0 ? [] : [0, NaN, 1]); assert.sameValue(result.size, items.length === 0 ? 0 : 3);
  if (items.length > 0) {
    const zero = result.get(0), nan = result.get(NaN), one = result.get(1); if (zero === undefined || nan === undefined || one === undefined) throw new Test262Error("missing group");
    assert.sameValue([...result.keys()][0], 0); assert.compareArray(zero, [-0, 0]); assert.sameValue(zero[0], -0);
    assert.compareArray(nan, [NaN, NaN]); assert.compareArray(one, [1]); assert.sameValue(zero === items, false);
  }
  assert.compareArray(items, original); assert.sameValue(result instanceof Map, true);
}
