/*---
description: "Entries pair each relative index with its current signed byte value. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-map-set, ts-tuples, ts-destructuring]
---*/

function localInt8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function* localEntries(data: number[]): IterableIterator<[number, number]> { for (let i = 0; i < data.length; i++) yield [i, data[i]]; }
// Entries pair each relative index with its current signed byte value. Route: arrays read from a guarded Map.
// Node prints iteration-entries-live-map:ok.
type Values = number[];
const routes: Map<string, Values> = new Map([['first', localInt8Array([-1, 5, 7])], ['second', localInt8Array([-1, 5, 7])]]);
for (const name of ['first', 'second']) {
  const data = routes.get(name); if (data === undefined) throw new Error("missing route");
  const seen: number[] = [];
  for (const [index, value] of localEntries(data)) { seen.push(index, value); if (index === 0) data[2] = -9; }
  assert.compareArray(seen, [0, -1, 1, 5, 2, -9]);
}
console.log("iteration-entries-live-map:ok");
