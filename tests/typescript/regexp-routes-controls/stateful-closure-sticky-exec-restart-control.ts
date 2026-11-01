/*---
description: "Control for stateful-closure-sticky-exec-restart; A retained exec closure carries sticky lastIndex, fails at a gap and resumes from zero after failure."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// A typed closure retains /(a)?(b)/y; node neither searches past the current index nor loses the reset before the next closure call. The control uses a fresh literal with an independent planned lastIndex before each call, repeated twice.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0, 0, 0, 0], expected: ["miss", 0, "miss", 0, "miss", 0, "miss", 0], count: 0 },
  { text: "abb", starts: [0, 2, 3, 0], expected: ["hit", 0, 3, "ab", "a", "b", 2, "hit", 2, 3, "b", undefined, "b", 3, "miss", 0, "hit", 0, 3, "ab", "a", "b", 2], count: 3 },
  { text: "abxb", starts: [0, 2, 0, 2], expected: ["hit", 0, 3, "ab", "a", "b", 2, "miss", 0, "hit", 0, 3, "ab", "a", "b", 2, "miss", 0], count: 2 },
  { text: "b", starts: [0, 1, 0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0, "hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 2 },
  { text: "b\u0301", starts: [0, 1, 0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0, "hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 2 },
  { text: "b\nb", starts: [0, 1, 0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0, "hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 2 },
  { text: "b\r\nb", starts: [0, 1, 0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0, "hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 2 },
  { text: "b\u2028b", starts: [0, 1, 0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0, "hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 2 },
  { text: "\ud83d\ude00b", starts: [0, 0, 0, 0], expected: ["miss", 0, "miss", 0, "miss", 0, "miss", 0], count: 0 },
  { text: "xyz", starts: [0, 0, 0, 0], expected: ["miss", 0, "miss", 0, "miss", 0, "miss", 0], count: 0 }
];
function inspect(row: InputRow): void {
  for (const repeat of [0, 1]) {
    const log: unknown[] = []; let count = 0;
    for (let i = 0; i < 4; i++) { const direct = /(a)?(b)/y; direct.lastIndex = row.starts[i]; const result = direct.exec(row.text); record(result, row.text, direct.lastIndex, log); if (result !== null) count++; }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
