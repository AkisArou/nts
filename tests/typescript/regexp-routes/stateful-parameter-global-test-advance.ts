/*---
description: "Global test calls through a RegExp parameter advance one shared expression and reset it on failure."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases]
---*/
// A RegExp parameter reaches /a/g repeatedly; node returns the exact boolean and UTF-16 lastIndex on every call, including the call after failure.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "xyz", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "a", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "\ud83d\ude00a", starts: [0, 3, 0, 3], expected: [true, 3, false, 0, true, 3, false, 0], count: 2 },
  { text: "\r\na", starts: [0, 3, 0, 3], expected: [true, 3, false, 0, true, 3, false, 0], count: 2 },
  { text: "\u2028a", starts: [0, 2, 0, 2], expected: [true, 2, false, 0, true, 2, false, 0], count: 2 },
  { text: "aba", starts: [0, 1, 3, 0], expected: [true, 1, true, 3, false, 0, true, 1], count: 3 },
  { text: "a\u0301a", starts: [0, 1, 3, 0], expected: [true, 1, true, 3, false, 0, true, 1], count: 3 },
  { text: "a\na", starts: [0, 1, 3, 0], expected: [true, 1, true, 3, false, 0, true, 1], count: 3 }
];
function accepts(expression: RegExp, text: string): boolean { return expression.test(text); }
function inspect(row: InputRow): void {
  const literal = /a/g;
  for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
    const log: unknown[] = []; let count = 0;
    for (let i = 0; i < 4; i++) { const found = accepts(expression, row.text); log.push(found, expression.lastIndex); if (found) count++; }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
