/*---
description: Control for builtin-set-entries-stored; explicit iterator calls preserve the same protocol history.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-unions, ts-numbers, ts-null-undefined, ts-map-set, ts-tuples]
---*/
// Control: advance the same native iterator local directly in the same next loop, keeping its calls, log and assertions.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: [BuiltinValue, BuiltinValue][] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [[0, 0]] },
  { values: [undefined], expected: [[undefined, undefined]] },
  { values: [marker], expected: [[marker, marker]] },
  { values: [-0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker, NaN, 0], expected: [[0, 0], [NaN, NaN], [0.5, 0.5], [2147483648, 2147483648], ["\u00e9\u4e2d", "\u00e9\u4e2d"], [undefined, undefined], [marker, marker]] },
];
interface BuiltinIteratorSlot<T> { cursor: Iterator<T, undefined, unknown>; }
for (const row of rows) {
  const source = new Set<BuiltinValue>(row.values);
  const cursor: Iterator<[BuiltinValue, BuiltinValue], undefined, unknown> = source.entries();
  const carrier: BuiltinIteratorSlot<[BuiltinValue, BuiltinValue]> = { cursor }; const log: unknown[] = []; const seen: [BuiltinValue, BuiltinValue][] = []; let steps: number = 0;
  while (true) {
    log.push("next", 0, undefined); const step: IteratorResult<[BuiltinValue, BuiltinValue], undefined> = cursor.next(); steps++; log.push("done", step.done === true);
    if (step.done) break;
    const value = step.value; log.push("receive", seen.length, value[0], value[1]); seen.push(value);
  }
  log.push("next", 1, "after"); const ended = cursor.next("after"); steps++; log.push("done", ended.done === true);
  assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = [];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i][0], row.expected[i][1]);
  expected.push("next", 0, undefined, "done", true, "next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    for (let part = 0; part < 2; part++) { assert.sameValue(Object.is(seen[i][part], row.expected[i][part]), true); assert.sameValue(typeof seen[i][part], typeof row.expected[i][part]); }
  }
  assert.sameValue(steps, row.expected.length + 2); assert.sameValue(carrier.cursor, cursor);
  assert.sameValue(source.size, row.expected.length); for (const value of row.values) assert.sameValue(source.has(value), true);
}
