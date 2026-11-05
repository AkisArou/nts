/*---
description: "reverse keeps a stored undefined owned and moves the distinct leading hole to the end. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse keeps a stored undefined owned and moves the distinct leading hole to the end. Route: guarded Map.get lookup. Node prints changing-reverse-stored:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localReverse(values: V[], present: boolean[]): V[] { for (let i = 0; i < values.length / 2; i++) { const j = values.length - 1 - i; const v = values[i], f = present[i]; values[i] = values[j]; present[i] = present[j]; values[j] = v; present[j] = f; } return values; }
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localReverse(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [3, undefined, undefined]);
assert.compareArray(currentOwn, [true, true, false]);
assert.sameValue(result, target);
console.log("changing-reverse-stored:ok");
