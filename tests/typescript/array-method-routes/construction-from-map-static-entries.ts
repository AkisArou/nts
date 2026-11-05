/*---
description: "Array.from preserves ordered Map entry pairs and shallow values independently of later Map and pair writes."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-objects, ts-strings, ts-class, ts-class-fields, ts-static, ts-map-set, ts-unions]
---*/

// Array.from preserves ordered Map entry pairs and shallow values independently of later Map and pair writes. Route: a static Map field. Node prints construction-from-map-static-entries:ok.
interface FromPoint { id: number; }
const first: FromPoint = { id: 1 }, second: FromPoint = { id: 2 }, replacement: FromPoint = { id: 9 };
class MapHolder { static values: Map<string, FromPoint> = new Map([["left", first], ["right", second]]); }
const result = Array.from(MapHolder.values);
assert.sameValue(result.length, 2);
assert.compareArray(result[0], ["left", first]);
assert.compareArray(result[1], ["right", second]);
assert.sameValue(result[0][1] === first, true); assert.sameValue(result[1][1] === second, true);
MapHolder.values.set("left", replacement); MapHolder.values.delete("right"); MapHolder.values.set("later", first);
assert.compareArray(result[0], ["left", first]);
assert.compareArray(result[1], ["right", second]);
result[0][0] = "changed"; first.id = 11;
assert.sameValue(MapHolder.values.has("changed"), false);
assert.sameValue(MapHolder.values.get("left") === replacement, true); assert.sameValue(result[0][1].id, 11);
console.log("construction-from-map-static-entries:ok");
