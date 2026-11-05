/*---
description: "reduce passes a differently typed accumulator through every index and the original receiver through a constrained generic at two item types."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-arrow-functions]
---*/
// reduce passes a differently typed accumulator through every index and the original receiver; route: a constrained generic at two item types.
// Node prints: callbacks-reduce-generic-record:ok
type FoldSummary = { text: string; count: number };
function describe<T extends { id: number }>(items: T[]): FoldSummary {
  const log: string[] = [];
  const initial: FoldSummary = { text: "start", count: 0 };
  const callback = (summary: FoldSummary, value: T, index: number, owner: T[]): FoldSummary => {
    log[log.length] = index + ":" + summary.count + ":" + value.id + ":" + (owner === items);
    return { text: summary.text + ":" + value.id + "@" + index, count: summary.count + 1 };
  };
  const result = items.reduce<FoldSummary>(callback, initial);
  assert.compareArray(log, ["0:0:9:true", "1:1:2:true"]);
  assert.sameValue(result.text, "start:9@0:2@1"); assert.sameValue(result.count, 2);
  assert.sameValue(initial.text, "start"); assert.sameValue(initial.count, 0);
  assert.sameValue(result === initial, false);
  return result;
}
describe<{ id: number; label: string }>([{ id: 9, label: "a" }, { id: 2, label: "b" }]);
describe<{ id: number; enabled: boolean }>([{ id: 9, enabled: true }, { id: 2, enabled: false }]);
console.log("callbacks-reduce-generic-record:ok");
