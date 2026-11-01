/*---
description: "An empty global exec loop progresses only through explicit Unicode-aware lastIndex writes and ends with failure reset."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined, ts-generics, ts-generic-constraints]
---*/
// A generic writer advances /()/gu after each empty match, taking one surrogate pair as two code units; node visits every planned boundary once and resets at past-end failure.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0, 1], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "miss", 0], count: 1 },
  { text: "ab", starts: [0, 1, 2, 3], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "hit", 2, 2, "", "", 2, "advance", 3, "miss", 0], count: 3 },
  { text: "\ud83d\ude00a", starts: [0, 2, 3, 4], expected: ["hit", 0, 2, "", "", 0, "advance", 2, "hit", 2, 2, "", "", 2, "advance", 3, "hit", 3, 2, "", "", 3, "advance", 4, "miss", 0], count: 3 },
  { text: "e\u0301", starts: [0, 1, 2, 3], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "hit", 2, 2, "", "", 2, "advance", 3, "miss", 0], count: 3 },
  { text: "\n", starts: [0, 1, 2], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "miss", 0], count: 2 },
  { text: "\r\n", starts: [0, 1, 2, 3], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "hit", 2, 2, "", "", 2, "advance", 3, "miss", 0], count: 3 },
  { text: "\u2028", starts: [0, 1, 2], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "miss", 0], count: 2 },
  { text: "xyz", starts: [0, 1, 2, 3, 4], expected: ["hit", 0, 2, "", "", 0, "advance", 1, "hit", 1, 2, "", "", 1, "advance", 2, "hit", 2, 2, "", "", 2, "advance", 3, "hit", 3, 2, "", "", 3, "advance", 4, "miss", 0], count: 4 }
];
function advance<T extends RegExp>(expression: T, text: string): void { const point = text.codePointAt(expression.lastIndex); expression.lastIndex += point !== undefined && point > 65535 ? 2 : 1; }
function inspect(row: InputRow): void {
  const literal = /()/gu;
  for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
    const log: unknown[] = []; let count = 0;
    while (true) {
      same(count < row.starts.length, true); const result = expression.exec(row.text); record(result, row.text, expression.lastIndex, log);
      if (result === null) break; same(result[0], ""); advance(expression, row.text); log.push("advance", expression.lastIndex); count++;
    }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
