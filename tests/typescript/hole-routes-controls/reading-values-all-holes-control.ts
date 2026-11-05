/*---
description: "values visits both absent positions as undefined without creating owned source indexes. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// values visits both absent positions as undefined without creating owned source indexes. Route: guarded Map.get lookup. Node prints reading-values-all-holes:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [false, undefined]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localValues(data: T[], present: boolean[]): T[] { const result: T[] = []; for (let i = 0; i < data.length; i++) result.push(present[i] ? data[i] : undefined); return result; }
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localValues(target, present);
assert.compareArray(result, [undefined, undefined]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, false]);
console.log("reading-values-all-holes:ok");
