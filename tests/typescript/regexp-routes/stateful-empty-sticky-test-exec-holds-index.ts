/*---
description: "Empty sticky test and exec calls share an unchanged index, including a failed past-end test followed by reset."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined, ts-closures, ts-function-types]
---*/
// A typed test closure and direct exec share /()/y seeded at one; node preserves empty-match positions and resets only a failed past-end call.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [1, 0, 0], expected: ["test", false, 0, "hit", 0, 2, "", "", 0, "test", true, 0], count: 1 },
  { text: "a", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "\ud83d\ude00", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "e\u0301", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "\n", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "\r\n", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "\u2028", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 },
  { text: "xyz", starts: [1, 1, 1], expected: ["test", true, 1, "hit", 1, 2, "", "", 1, "test", true, 1], count: 1 }
];
function inspect(row: InputRow): void {
  const literal = /()/y;
  for (const expression of [literal, new RegExp(literal.source, literal.flags)]) {
    const test: (text: string) => boolean = text => expression.test(text), log: unknown[] = []; expression.lastIndex = 1;
    log.push("test", test(row.text), expression.lastIndex);
    const result = expression.exec(row.text); record(result, row.text, expression.lastIndex, log); same(result === null ? 0 : 1, row.count);
    log.push("test", test(row.text), expression.lastIndex); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
