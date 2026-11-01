/*---
description: "Repeated empty global exec matches leave the shared lastIndex unchanged and retain empty captures."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined, ts-interfaces]
---*/
// An interface field holds /(a*)/g; three bounded calls show node returns an empty full match and capture repeatedly at the same index instead of advancing.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "ba", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "\ud83d\ude00a", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "e\u0301", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "\na", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "\r\na", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "\u2028a", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "xyz", starts: [0, 0, 0], expected: ["hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0, "hit", 0, 2, "", "", 0], count: 3 },
  { text: "a", starts: [0, 1, 1], expected: ["hit", 0, 2, "a", "a", 1, "hit", 1, 2, "", "", 1, "hit", 1, 2, "", "", 1], count: 3 },
  { text: "aa", starts: [0, 2, 2], expected: ["hit", 0, 2, "aa", "aa", 2, "hit", 2, 2, "", "", 2, "hit", 2, 2, "", "", 2], count: 3 },
  { text: "a\u0301", starts: [0, 1, 1], expected: ["hit", 0, 2, "a", "a", 1, "hit", 1, 2, "", "", 1, "hit", 1, 2, "", "", 1], count: 3 }
];
interface PatternCell { expression: RegExp; }
function inspect(row: InputRow): void {
  const literal = /(a*)/g;
  for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
    const cell: PatternCell = { expression }, log: unknown[] = []; let count = 0; same(cell.expression, expression);
    for (let i = 0; i < 3; i++) { const result = cell.expression.exec(row.text); same(expression.lastIndex, cell.expression.lastIndex); record(result, row.text, expression.lastIndex, log); if (result !== null) count++; }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
