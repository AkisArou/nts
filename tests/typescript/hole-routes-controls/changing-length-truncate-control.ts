/*---
description: "truncating length to two discards the last number and leaves the retained middle hole. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// truncating length to two discards the last number and leaves the retained middle hole. Route: guarded Map.get lookup. Node prints changing-length-truncate:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localLength(values: V[], present: boolean[], size: number): void { while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
localLength(target, present, 2);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, undefined]);
assert.compareArray(currentOwn, [true, false]);
console.log("changing-length-truncate:ok");
