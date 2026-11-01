/*---
description: "Control for stateful-field-global-exec-loop; A global exec loop reads and updates one RegExp held in an interface field through its terminal failure."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// An interface field carries /(a)?(b)/g; node logs every full match, optional capture, UTF-16 index and lastIndex, then resets the shared expression on failure. The control uses a fresh literal with an independent planned lastIndex before each call, repeated twice.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function record(result: RegExpExecArray | null, text: string, after: number, log: unknown[]): void {
  if (result === null) { log.push("miss", after); return; }
  same(result.input, text); same(result.groups, undefined); log.push("hit", result.index, result.length); for (const value of result) log.push(value); log.push(after);
}
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0], expected: ["miss", 0], count: 0 },
  { text: "abxb", starts: [0, 2, 4], expected: ["hit", 0, 3, "ab", "a", "b", 2, "hit", 3, 3, "b", undefined, "b", 4, "miss", 0], count: 2 },
  { text: "b", starts: [0, 1], expected: ["hit", 0, 3, "b", undefined, "b", 1, "miss", 0], count: 1 },
  { text: "\ud83d\ude00ab", starts: [0, 4], expected: ["hit", 2, 3, "ab", "a", "b", 4, "miss", 0], count: 1 },
  { text: "e\u0301b", starts: [0, 3], expected: ["hit", 2, 3, "b", undefined, "b", 3, "miss", 0], count: 1 },
  { text: "a\nb", starts: [0, 3], expected: ["hit", 2, 3, "b", undefined, "b", 3, "miss", 0], count: 1 },
  { text: "a\r\nb", starts: [0, 4], expected: ["hit", 3, 3, "b", undefined, "b", 4, "miss", 0], count: 1 },
  { text: "\u2028b", starts: [0, 2], expected: ["hit", 1, 3, "b", undefined, "b", 2, "miss", 0], count: 1 },
  { text: "xyz", starts: [0], expected: ["miss", 0], count: 0 }
];
function inspect(row: InputRow): void {
  for (const repeat of [0, 1]) {
    const log: unknown[] = []; let count = 0;
    while (true) {
      same(count < row.starts.length, true); const expression = /(a)?(b)/g, direct = expression; same(direct, expression); expression.lastIndex = row.starts[count]; const result = direct.exec(row.text);
      same(expression.lastIndex, direct.lastIndex); record(result, row.text, expression.lastIndex, log); if (result === null) break; count++;
    }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
