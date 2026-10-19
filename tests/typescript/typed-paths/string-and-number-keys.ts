/*---
description: A Map keeps the string "1" and the number 1 apart; an object's keys coalesce them.
features: [ts-map-set, ts-objects, ts-unions]
---*/
const map = new Map<string | number, string>();
map.set(1, "number");
map.set("1", "string");
assert.sameValue(map.size, 2);
assert.sameValue(map.get(1), "number");
const object: Record<string | number, string> = {};
object[1] = "number";
object["1"] = "string";
assert.sameValue(Object.keys(object).length, 1);
assert.sameValue(object[1], "string");
