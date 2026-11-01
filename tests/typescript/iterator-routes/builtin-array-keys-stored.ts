/*---
description: A stored array keys iterator preserves typed result values, call arguments and permanent exhaustion.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-unions, ts-numbers, ts-null-undefined]
---*/
// Route: a native array.keys iterator is stored in an interface member and advanced by hand; node preserves payloads and done state.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: number[] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [0] },
  { values: [undefined], expected: [0] },
  { values: [marker], expected: [0] },
  { values: [1, -0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker], expected: [0, 1, 2, 3, 4, 5, 6, 7] },
];
interface BuiltinIteratorSlot<T> { cursor: Iterator<T, undefined, unknown>; }
for (const row of rows) {
  const source: BuiltinValue[] = row.values.slice();
  const cursor: Iterator<number, undefined, unknown> = source.keys();
  const carrier: BuiltinIteratorSlot<number> = { cursor }; const log: unknown[] = []; const seen: number[] = []; let steps: number = 0;
  while (true) {
    log.push("next", 0, undefined); const step: IteratorResult<number, undefined> = carrier.cursor.next(); steps++; log.push("done", step.done === true);
    if (step.done) break;
    const value = step.value; log.push("receive", seen.length, value); seen.push(value);
  }
  log.push("next", 1, "after"); const ended = carrier.cursor.next("after"); steps++; log.push("done", ended.done === true);
  assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = [];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i]);
  expected.push("next", 0, undefined, "done", true, "next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    assert.sameValue(Object.is(seen[i], row.expected[i]), true); assert.sameValue(typeof seen[i], typeof row.expected[i]);
  }
  assert.sameValue(steps, row.expected.length + 2); assert.sameValue(carrier.cursor, cursor);
  assert.sameValue(source.length, row.values.length); for (let i = 0; i < row.values.length; i++) assert.sameValue(Object.is(source[i], row.values[i]), true);
}
