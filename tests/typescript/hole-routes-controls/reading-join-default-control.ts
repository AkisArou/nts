/*---
description: "join prints an absent middle index as an empty field, producing 1,,3. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join prints an absent middle index as an empty field, producing 1,,3. Route: guarded Map.get lookup. Node prints reading-join-default:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localJoin(data: T[], present: boolean[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += separator; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localJoin(target, present);
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-join-default:ok");
