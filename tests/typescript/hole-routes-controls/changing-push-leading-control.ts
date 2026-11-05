/*---
description: "push(5) appends an owned value without filling the leading hole. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// push(5) appends an owned value without filling the leading hole. Route: guarded Map.get lookup. Node prints changing-push-leading:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localPush(values: V[], present: boolean[], value: V): number { values.push(value); present.push(true); return values.length; }
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localPush(target, present, 5);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [undefined, 2, 5]);
assert.compareArray(currentOwn, [false, true, true]);
assert.sameValue(result, 3);
console.log("changing-push-leading:ok");
