/*---
description: "Splice distinguishes an omitted count from explicit undefined negative zero NaN finite and infinite counts through a narrowed discriminated union of count arguments."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-discriminated-unions, ts-unions, ts-type-aliases, ts-readonly, ts-tuples, ts-numbers, ts-null-undefined]
---*/

// Splice distinguishes an omitted count from explicit undefined negative zero NaN finite and infinite counts; route: a narrowed discriminated union of count arguments.
// Node prints writes-splice-discriminated-count-presence:ok.
type Action = { kind: "omitted" } | { kind: "undefined"; count: undefined } | { kind: "count"; count: number };
function remove(input: number[], action: Action): number[] {
  if (action.kind === "omitted") return input.splice(1);
  return input.splice(1, action.count);
}
const rows: readonly [Action, readonly number[], readonly number[]][] = [
  [{ kind: "omitted" }, [2, 3, 4], [1]], [{ kind: "undefined", count: undefined }, [], [1, 2, 3, 4]],
  [{ kind: "count", count: -2 }, [], [1, 2, 3, 4]], [{ kind: "count", count: -0 }, [], [1, 2, 3, 4]],
  [{ kind: "count", count: NaN }, [], [1, 2, 3, 4]], [{ kind: "count", count: 2 }, [2, 3], [1, 4]],
  [{ kind: "count", count: Infinity }, [2, 3, 4], [1]]
];
for (const [action, removed, remaining] of rows) {
  const input: number[] = [1, 2, 3, 4], result = remove(input, action);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-discriminated-count-presence:ok");
