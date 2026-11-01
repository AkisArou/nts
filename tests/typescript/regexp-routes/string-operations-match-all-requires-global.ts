/*---
description: "A non-global RegExp routed through a field makes matchAll throw before returning an iterator."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-errors, ts-arrow-functions, ts-closures]
---*/
// Matching, no-match and empty strings all throw TypeError at iterator creation; node preserves the original negative-zero or nonzero lastIndex.
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
    assert.throws(TypeError, () => { log.push("call", expression.lastIndex); const iterator = row.input.matchAll(expression); log.push("returned", iterator); });
    log.push("caught", "TypeError", expression.lastIndex); expected.push("call", start, "caught", "TypeError", start);
  }
  exact(log, expected);
}
for (const row of rows) {
  const literal = /a/; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
