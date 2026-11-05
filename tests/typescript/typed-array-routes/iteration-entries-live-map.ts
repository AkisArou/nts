/*---
description: "Entries pair each relative index with its current signed byte value."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-map-set, ts-tuples, ts-destructuring]
---*/

// Entries pair each relative index with its current signed byte value. Route: arrays read from a guarded Map.
// Node prints iteration-entries-live-map:ok.
type Values = Int8Array;
const routes: Map<string, Values> = new Map([['first', new Int8Array([-1, 5, 7])], ['second', new Int8Array([-1, 5, 7])]]);
for (const name of ['first', 'second']) {
  const data = routes.get(name); if (data === undefined) throw new Error("missing route");
  const seen: number[] = [];
  for (const [index, value] of data.entries()) { seen.push(index, value); if (index === 0) data[2] = -9; }
  assert.compareArray(seen, [0, -1, 1, 5, 2, -9]);
}
console.log("iteration-entries-live-map:ok");
