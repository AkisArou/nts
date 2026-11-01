/*---
description: A stored array entries iterator preserves typed result values, call arguments and permanent exhaustion.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-unions, ts-numbers, ts-null-undefined, ts-tuples]
---*/
// Route: a native array.entries iterator is stored in an interface member and advanced by hand; node preserves payloads and done state.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: [number, BuiltinValue][] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [[0, -0]] },
  { values: [undefined], expected: [[0, undefined]] },
  { values: [marker], expected: [[0, marker]] },
  { values: [1, -0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker], expected: [[0, 1], [1, -0], [2, NaN], [3, 0.5], [4, 2147483648], [5, "\u00e9\u4e2d"], [6, undefined], [7, marker]] },
];
interface BuiltinIteratorSlot<T> { cursor: Iterator<T, undefined, unknown>; }
for (const row of rows) {
  const source: BuiltinValue[] = row.values.slice();
  const cursor: Iterator<[number, BuiltinValue], undefined, unknown> = source.entries();
  const carrier: BuiltinIteratorSlot<[number, BuiltinValue]> = { cursor }; const log: unknown[] = []; const seen: [number, BuiltinValue][] = []; let steps: number = 0;
  while (true) {
    log.push("next", 0, undefined); const step: IteratorResult<[number, BuiltinValue], undefined> = carrier.cursor.next(); steps++; log.push("done", step.done === true);
    if (step.done) break;
    const value = step.value; log.push("receive", seen.length, value[0], value[1]); seen.push(value);
  }
  log.push("next", 1, "after"); const ended = carrier.cursor.next("after"); steps++; log.push("done", ended.done === true);
  assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = [];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i][0], row.expected[i][1]);
  expected.push("next", 0, undefined, "done", true, "next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    for (let part = 0; part < 2; part++) { assert.sameValue(Object.is(seen[i][part], row.expected[i][part]), true); assert.sameValue(typeof seen[i][part], typeof row.expected[i][part]); }
  }
  assert.sameValue(steps, row.expected.length + 2); assert.sameValue(carrier.cursor, cursor);
  assert.sameValue(source.length, row.values.length); for (let i = 0; i < row.values.length; i++) assert.sameValue(Object.is(source[i], row.values[i]), true);
}
