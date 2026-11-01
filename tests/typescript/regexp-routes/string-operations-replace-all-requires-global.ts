/*---
description: "A non-global RegExp passed through a holder makes replaceAll throw before calling its callback."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-errors, ts-arrow-functions, ts-closures]
---*/
// Empty and matching strings take the same typed route; node throws TypeError immediately and leaves signed-zero or nonzero lastIndex unchanged.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Row = { input: string };
const rows: Row[] = [
  { input: "" },
  { input: "aba" },
  { input: "\ud83d\ude00a" },
  { input: "e\u0301a" },
  { input: "\na" },
  { input: "\r\na" },
  { input: "\u2028a" },
  { input: "zzz" }
];
interface PatternHolder { pattern: RegExp }
function inspect<T extends PatternHolder>(holder: T, row: Row): void {
  const expression = holder.pattern;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0];
  for (const start of [-0, 4]) {
    expression.lastIndex = start; same(expression.lastIndex, start);
    assert.throws(TypeError, () => { log.push("call", expression.lastIndex); const output = row.input.replaceAll(expression, (match: string): string => { log.push("callback", match); return "x"; }); log.push("returned", output); });
    log.push("caught", "TypeError", expression.lastIndex); expected.push("call", start, "caught", "TypeError", start);
  }
  exact(log, expected);
}
for (const row of rows) {
  const literal = /(?<word>a)(b)?/; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
