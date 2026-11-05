/*---
description: "values visits both absent positions as undefined without creating owned source indexes."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// values visits both absent positions as undefined without creating owned source indexes. Route: guarded Map.get lookup. Node prints reading-values-all-holes:ok.
type T = number | undefined | null;
const items: T[] = [, ,];
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result: T[] = []; for (const value of target.values()) result.push(value);
assert.compareArray(result, [undefined, undefined]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, false]);
console.log("reading-values-all-holes:ok");
