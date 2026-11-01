/*---
description: "Control for stateful-alias-lastindex-reset-coercion; Generic lastIndex writes through one alias are observed through another before and after matching."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// An interface field and generic writer share /(a)/g; node preserves each written number until exec applies ToLength and an explicit zero reset replays the first match. The control uses a fresh literal with an independent planned lastIndex before each call, repeated twice.
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
function inspect(row: ResetRow): void {
  const seeds = [-0, NaN, -3, 0.9, 1.9, 2.9, Infinity, row.text.length + 1];
  for (let i = 0; i < seeds.length; i++) for (const repeat of [0, 1]) {
    const log: unknown[] = [], expected: unknown[] = ["seed", seeds[i]], first = /(a)/g;
    first.lastIndex = seeds[i]; log.push("seed", first.lastIndex); record(first.exec(row.text), row.text, first.lastIndex, log);
    const second = /(a)/g; second.lastIndex = 0; log.push("reset", second.lastIndex); record(second.exec(row.text), row.text, second.lastIndex, log);
    expectedMatch(row.positions[i], expected); expected.push("reset", 0); expectedMatch(row.positions[0], expected); check(log, expected);
  }
}
for (const row of rows) inspect(row);
