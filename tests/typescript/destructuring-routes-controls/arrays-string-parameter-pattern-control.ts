/*---
description: "Control for arrays-string-parameter-pattern; replace the pattern with explicit ordered iterator reads."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration]
---*/
// The [head, ...tail] pattern reads a string-typed parameter directly; node binds whole code points, defaults only the empty input and collects the remaining characters. The control advances and closes explicitly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: { text: string; points: string[] }[] = [
  { text: "", points: [] }, { text: "A", points: ["A"] }, { text: "😀中Z", points: ["😀", "中", "Z"] }, { text: "\ud800x", points: ["\ud800", "x"] }
];
function inspect(text: string, points: string[]): void {
  const log: unknown[] = [];
  function fallback(): string { log.push("default", "empty"); return "empty"; }
  const cursor = text[Symbol.iterator](), step = cursor.next(), raw = step.done ? undefined : step.value;
  const head = raw === undefined ? fallback() : raw, tail: string[] = [];
  if (!step.done) for (;;) { const part = cursor.next(); if (part.done) break; tail.push(part.value); }
  same(head, points.length === 0 ? "empty" : points[0]); same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, Math.max(points.length - 1, 0));
  for (let i = 0; i < tail.length; i++) same(tail[i], points[i + 1]);
  assert.compareArray(log, points.length === 0 ? ["default", "empty"] : []);
}
for (const row of rows) inspect(row.text, row.points);
