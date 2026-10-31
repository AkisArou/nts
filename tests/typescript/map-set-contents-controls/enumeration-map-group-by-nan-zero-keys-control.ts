/*---
description: Control for enumeration-map-group-by-nan-zero-keys; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-interfaces, ts-arrays, ts-arrow-functions, ts-spread, ts-numbers]
---*/
// Paired case: ../map-set-contents/enumeration-map-group-by-nan-zero-keys.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
interface Row { key: number; value: number }
function check(n: number): void {
  const first = NaN, second = -0;
  const rows: Row[] = [{ key: first, value: n }, { key: second, value: n + 1 },
    { key: first, value: n + 2 }, { key: second, value: n + 3 }];
  const grouped: Map<number, Row[]> = Map.groupBy(rows, (row: Row): number => row.key);
  const view: Map<number, Row[]> = grouped;
  const keys = Array.from(view.keys()), types: string[] = [];
  for (const key of keys) types.push(typeof key);
  assert.compareArray(keys, [NaN, 0]); assert.compareArray(types, ["number", "number"]);
  assert.sameValue(view.size, 2);
  const a = view.get(first), b = view.get(second);
  if (a === undefined || b === undefined) throw new Test262Error("missing group");
  assert.compareArray(a, [rows[0], rows[2]]); assert.compareArray(b, [rows[1], rows[3]]);
  assert.compareArray(a.map(row => row.value), [n, n + 2]);
  assert.compareArray(b.map(row => row.value), [n + 1, n + 3]);
  for (const row of [...a, ...b]) { assert.sameValue(typeof row, "object"); assert.sameValue(typeof row.value, "number"); }
  assert.sameValue(view.has(+0), true);
}
for (const n of [2, 9, 40]) check(n);
