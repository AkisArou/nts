/*---
description: "One RegExp field carries state across exec, global match, replacement and split, then feeds the next exec."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined, ts-interfaces]
---*/
// An interface field shares /(a)/g between methods; node resets it for global match and replace, preserves it through split, and the following exec exposes each effect.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
function recordList(result: string[] | null, log: unknown[]): void { if (result === null) log.push(null); else { log.push(result.length); for (const value of result) log.push(value); } }
type StringRow = { text: string; starts: number[]; expected: unknown[] };
const rows: StringRow[] = [
  { text: "", starts: [1, 0, 0, 0, 0, 0, 0], expected: ["exec", "miss", 0, "match", null, 0, "exec", "miss", 0, "replace", "", 0, "exec", "miss", 0, "split", 1, "", 0, "exec", "miss", 0] },
  { text: "a", starts: [1, 0, 0, 1, 0, 1, 1], expected: ["exec", "miss", 0, "match", 1, "a", 0, "exec", "hit", 0, 2, "a", "a", 1, "replace", "#", 0, "exec", "hit", 0, 2, "a", "a", 1, "split", 3, "", "a", "", 1, "exec", "miss", 0] },
  { text: "aba", starts: [1, 3, 0, 1, 0, 1, 1], expected: ["exec", "hit", 2, 2, "a", "a", 3, "match", 2, "a", "a", 0, "exec", "hit", 0, 2, "a", "a", 1, "replace", "#b#", 0, "exec", "hit", 0, 2, "a", "a", 1, "split", 5, "", "a", "b", "a", "", 1, "exec", "hit", 2, 2, "a", "a", 3] },
  { text: "\ud83d\ude00a", starts: [1, 3, 0, 3, 0, 3, 3], expected: ["exec", "hit", 2, 2, "a", "a", 3, "match", 1, "a", 0, "exec", "hit", 2, 2, "a", "a", 3, "replace", "\ud83d\ude00#", 0, "exec", "hit", 2, 2, "a", "a", 3, "split", 3, "\ud83d\ude00", "a", "", 3, "exec", "miss", 0] },
  { text: "e\u0301a", starts: [1, 3, 0, 3, 0, 3, 3], expected: ["exec", "hit", 2, 2, "a", "a", 3, "match", 1, "a", 0, "exec", "hit", 2, 2, "a", "a", 3, "replace", "e\u0301#", 0, "exec", "hit", 2, 2, "a", "a", 3, "split", 3, "e\u0301", "a", "", 3, "exec", "miss", 0] },
  { text: "a\na", starts: [1, 3, 0, 1, 0, 1, 1], expected: ["exec", "hit", 2, 2, "a", "a", 3, "match", 2, "a", "a", 0, "exec", "hit", 0, 2, "a", "a", 1, "replace", "#\n#", 0, "exec", "hit", 0, 2, "a", "a", 1, "split", 5, "", "a", "\n", "a", "", 1, "exec", "hit", 2, 2, "a", "a", 3] },
  { text: "a\r\na", starts: [1, 4, 0, 1, 0, 1, 1], expected: ["exec", "hit", 3, 2, "a", "a", 4, "match", 2, "a", "a", 0, "exec", "hit", 0, 2, "a", "a", 1, "replace", "#\r\n#", 0, "exec", "hit", 0, 2, "a", "a", 1, "split", 5, "", "a", "\r\n", "a", "", 1, "exec", "hit", 3, 2, "a", "a", 4] },
  { text: "\u2028a", starts: [1, 2, 0, 2, 0, 2, 2], expected: ["exec", "hit", 1, 2, "a", "a", 2, "match", 1, "a", 0, "exec", "hit", 1, 2, "a", "a", 2, "replace", "\u2028#", 0, "exec", "hit", 1, 2, "a", "a", 2, "split", 3, "\u2028", "a", "", 2, "exec", "miss", 0] },
  { text: "xyz", starts: [1, 0, 0, 0, 0, 0, 0], expected: ["exec", "miss", 0, "match", null, 0, "exec", "miss", 0, "replace", "xyz", 0, "exec", "miss", 0, "split", 1, "xyz", 0, "exec", "miss", 0] }
];
interface PatternCell { expression: RegExp; }
function inspect(row: StringRow): void {
  const literal = /(a)/g;
  for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
    const cell: PatternCell = { expression }, log: unknown[] = []; expression.lastIndex = 1;
    log.push("exec"); record(cell.expression.exec(row.text), row.text, expression.lastIndex, log);
    log.push("match"); recordList(row.text.match(cell.expression), log); log.push(expression.lastIndex);
    log.push("exec"); record(cell.expression.exec(row.text), row.text, expression.lastIndex, log);
    log.push("replace", row.text.replace(cell.expression, "#"), expression.lastIndex);
    log.push("exec"); record(cell.expression.exec(row.text), row.text, expression.lastIndex, log);
    log.push("split"); recordList(row.text.split(cell.expression), log); log.push(expression.lastIndex);
    log.push("exec"); record(cell.expression.exec(row.text), row.text, expression.lastIndex, log); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
