/*---
description: Control for builtin-map-values-stored; explicit iterator calls preserve the same protocol history.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-unions, ts-numbers, ts-null-undefined, ts-map-set]
---*/
// Control: advance the same native iterator local directly in the same next loop, keeping its calls, log and assertions.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: BuiltinValue[] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [-0] },
  { values: [undefined], expected: [undefined] },
  { values: [marker], expected: [marker] },
  { values: [1, -0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker], expected: [1, -0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker] },
];
interface BuiltinIteratorSlot<T> { cursor: Iterator<T, undefined, unknown>; }
for (const row of rows) {
  const source = new Map<number, BuiltinValue>();
  for (let i = 0; i < row.values.length; i++) source.set(i, row.values[i]);
  const cursor: Iterator<BuiltinValue, undefined, unknown> = source.values();
  const carrier: BuiltinIteratorSlot<BuiltinValue> = { cursor }; const log: unknown[] = []; const seen: BuiltinValue[] = []; let steps: number = 0;
  while (true) {
    log.push("next", 0, undefined); const step: IteratorResult<BuiltinValue, undefined> = cursor.next(); steps++; log.push("done", step.done === true);
    if (step.done) break;
    const value = step.value; log.push("receive", seen.length, value); seen.push(value);
  }
  log.push("next", 1, "after"); const ended = cursor.next("after"); steps++; log.push("done", ended.done === true);
  assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = [];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i]);
  expected.push("next", 0, undefined, "done", true, "next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    assert.sameValue(Object.is(seen[i], row.expected[i]), true); assert.sameValue(typeof seen[i], typeof row.expected[i]);
  }
  assert.sameValue(steps, row.expected.length + 2); assert.sameValue(carrier.cursor, cursor);
  assert.sameValue(source.size, row.values.length); for (let i = 0; i < row.values.length; i++) assert.sameValue(Object.is(source.get(i), row.values[i]), true);
}
