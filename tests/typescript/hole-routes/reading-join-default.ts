/*---
description: "join prints an absent middle index as an empty field, producing 1,,3."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join prints an absent middle index as an empty field, producing 1,,3. Route: guarded Map.get lookup. Node prints reading-join-default:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.join();
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-join-default:ok");
