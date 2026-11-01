/*---
description: "Generic lastIndex writes through one alias are observed through another before and after matching."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined, ts-interfaces, ts-generics, ts-generic-constraints]
---*/
// An interface field and generic writer share /(a)/g; node preserves each written number until exec applies ToLength and an explicit zero reset replays the first match.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type ResetRow = { text: string; positions: number[] };
function expectedMatch(index: number, log: unknown[]): void { if (index < 0) log.push("miss", 0); else log.push("hit", index, 2, "a", "a", index + 1); }
const rows: ResetRow[] = [
  { text: "", positions: [-1, -1, -1, -1, -1, -1, -1, -1] },
  { text: "a", positions: [0, 0, 0, 0, -1, -1, -1, -1] },
  { text: "aba", positions: [0, 0, 0, 0, 2, 2, -1, -1] },
  { text: "\ud83d\ude00a", positions: [2, 2, 2, 2, 2, 2, -1, -1] },
  { text: "e\u0301a", positions: [2, 2, 2, 2, 2, 2, -1, -1] },
  { text: "a\na", positions: [0, 0, 0, 0, 2, 2, -1, -1] },
  { text: "a\r\na", positions: [0, 0, 0, 0, 3, 3, -1, -1] },
  { text: "\u2028a", positions: [1, 1, 1, 1, 1, -1, -1, -1] },
  { text: "xyz", positions: [-1, -1, -1, -1, -1, -1, -1, -1] }
];
interface PatternCell { expression: RegExp; }
function reset<T extends RegExp>(expression: T, index: number): void { expression.lastIndex = index; }
function inspect(row: ResetRow): void {
  const seeds = [-0, NaN, -3, 0.9, 1.9, 2.9, Infinity, row.text.length + 1];
  for (let i = 0; i < seeds.length; i++) {
    const literal = /(a)/g;
    for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
      const cell: PatternCell = { expression }, log: unknown[] = [], expected: unknown[] = ["seed", seeds[i]];
      reset(expression, seeds[i]); log.push("seed", cell.expression.lastIndex); record(cell.expression.exec(row.text), row.text, cell.expression.lastIndex, log);
      reset(cell.expression, 0); log.push("reset", expression.lastIndex); record(expression.exec(row.text), row.text, expression.lastIndex, log);
      expectedMatch(row.positions[i], expected); expected.push("reset", 0); expectedMatch(row.positions[0], expected); check(log, expected);
    }
  }
}
for (const row of rows) inspect(row);
