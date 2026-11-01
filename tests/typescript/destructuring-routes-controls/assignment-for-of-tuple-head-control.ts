/*---
description: "Control for assignment-for-of-tuple-head; Tuple patterns in for-of heads combine defaults, elisions and rest with complete nested iterator histories."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-tuples, ts-tuple-optional, ts-tuple-rest, ts-symbols, ts-arrow-functions]
---*/
// Explicit reads keep the same inputs, protocol/default/getter log and observations. Retain the outer loop, explicitly consume each tuple cursor, skip the elided step and copy the remaining delivered values.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type AssignTuple = [AssignValue?, ...AssignValue[]];
for (const input of inputs) {
  const log: unknown[] = [], expected: unknown[] = ["outer.iterator"], rows: AssignTuple[] = [[], [input], [input, marker, undefined]];
  const outerValues = rows.values.bind(rows);
  rows[Symbol.iterator] = () => { log.push("outer.iterator"); const cursor = outerValues(), next = cursor.next;
    cursor.next = () => { const step = next.call(cursor); log.push("outer.next", step.done, step.value); return step; };
    cursor.return = () => { log.push("outer.return", true, undefined); return { done: true, value: undefined }; }; return cursor; };
  for (let i = 0; i < rows.length; i++) { const row = rows[i], original = row.values.bind(row);
    row[Symbol.iterator] = () => { log.push("inner.iterator", i); const cursor = original(), next = cursor.next;
      cursor.next = () => { const step = next.call(cursor); log.push("inner.next", i, step.done, step.value); return step; };
      cursor.return = () => { log.push("inner.return", i, true, undefined); return { done: true, value: undefined }; }; return cursor; };
  }
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  let rowIndex = 0;
  for (const tuple of rows) {
    const cursor = tuple[Symbol.iterator](), first = cursor.next(); const value = first.done ? undefined : first.value;
    const head = value === undefined ? fallback() : value, tail: AssignValue[] = []; let done = first.done === true;
    if (!done) done = cursor.next().done === true;
    while (!done) { const step = cursor.next(); if (step.done) done = true; else tail.push(step.value); }
    const row = rows[rowIndex], wanted = row[0] === undefined ? replacement : row[0]; same(head, wanted);
    same(typeof tail, "object"); same(Array.isArray(tail), true); same(Object.is(tail, row), false);
    assert.compareArray(Object.keys(tail), row.length === 3 ? ["0"] : []);
    same(tail.length, Math.max(0, row.length - 2)); for (let i = 0; i < tail.length; i++) same(tail[i], row[i + 2]);
    log.push("body", head, tail.length); expected.push("outer.next", false, row, "inner.iterator", rowIndex);
    for (let i = 0; i <= row.length; i++) { expected.push("inner.next", rowIndex, i === row.length, row[i]); if (i === 0 && row[0] === undefined) expected.push("default", replacement); }
    expected.push("body", wanted, Math.max(0, row.length - 2)); rowIndex++;
  }
  expected.push("outer.next", true, undefined); same(rowIndex, rows.length); assert.compareArray(log, expected);
}
