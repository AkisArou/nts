/*---
description: "A string iterator obtained from a typed parameter preserves code points, default timing and rest exhaustion."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-symbols, ts-optional-chaining, ts-closures, ts-destructuring, ts-spread]
---*/
// A string parameter supplies its own typed iterator; node binds a whole surrogate pair as one element and keeps a lone surrogate intact.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: { text: string; points: string[] }[] = [
  { text: "", points: [] }, { text: "A", points: ["A"] }, { text: "😀中Z", points: ["😀", "中", "Z"] }, { text: "\ud800x", points: ["\ud800", "x"] }
];
function trace<T>(source: Iterable<T, undefined, unknown>, log: unknown[], label: string): void {
  const open = source[Symbol.iterator].bind(source);
  source[Symbol.iterator] = function() {
    log.push(label + ".iterator"); const cursor = open(), next = cursor.next.bind(cursor), close = cursor.return?.bind(cursor);
    cursor.next = function() { const step = next(); log.push(label + ".next", step.done, step.value); return step; };
    cursor.return = function() { const empty: IteratorReturnResult<undefined> = { done: true, value: undefined }; const step = close === undefined ? empty : close(); log.push(label + ".return", step.done, step.value); return step; };
    return cursor;
  };
}
function inspect(text: string, points: string[]): void {
  const log: unknown[] = [], source = text[Symbol.iterator](); trace(source, log, "text");
  function fallback(): string { log.push("default", "empty"); return "empty"; }
  const [head = fallback(), ...tail] = source;
  same(head, points.length === 0 ? "empty" : points[0]); same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, Math.max(points.length - 1, 0));
  for (let i = 0; i < tail.length; i++) same(tail[i], points[i + 1]);
  const expected: unknown[] = ["text.iterator"];
  for (const point of points) expected.push("text.next", false, point);
  expected.push("text.next", true, undefined);
  if (points.length === 0) expected.push("default", "empty");
  assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.text, row.points);
