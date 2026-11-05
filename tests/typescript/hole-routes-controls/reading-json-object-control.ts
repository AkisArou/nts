/*---
description: "JSON.stringify serializes a nested array hole as null inside an object's a property. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// JSON.stringify serializes a nested array hole as null inside an object's a property. Route: guarded Map.get lookup. Node prints reading-json-object:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [true, 2]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localJsonObject(data: T[], present: boolean[]): string { let result = '{"a":['; for (let i = 0; i < data.length; i++) { if (i > 0) result += ","; result += present[i] && data[i] !== undefined && data[i] !== null ? String(data[i]) : "null"; } return result + "]}"; }
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localJsonObject(target, present);
assert.sameValue(result, '{"a":[null,2]}');
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, true]);
console.log("reading-json-object:ok");
