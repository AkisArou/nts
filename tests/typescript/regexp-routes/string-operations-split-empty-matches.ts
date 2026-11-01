/*---
description: "Typed empty-separator splitting distinguishes UTF-16 code units from Unicode code points and avoids empty edge output."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// Both global empty patterns cross the same generic field route; node returns no pieces for empty input and preserves a surrogate pair only under u.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Row = { input: string; units: string[]; points: string[]; unitStarts: number[]; pointStarts: number[] };
const rows: Row[] = [
  { input: "", units: [], points: [], unitStarts: [0], pointStarts: [0] },
  { input: "ab", units: ["a", "b"], points: ["a", "b"], unitStarts: [0, 1, 2], pointStarts: [0, 1, 2] },
  { input: "\ud83d\ude00", units: ["\ud83d", "\ude00"], points: ["\ud83d\ude00"], unitStarts: [0, 1, 2], pointStarts: [0, 2] },
  { input: "e\u0301", units: ["e", "\u0301"], points: ["e", "\u0301"], unitStarts: [0, 1, 2], pointStarts: [0, 1, 2] },
  { input: "\n", units: ["\n"], points: ["\n"], unitStarts: [0, 1], pointStarts: [0, 1] },
  { input: "\r\n", units: ["\r", "\n"], points: ["\r", "\n"], unitStarts: [0, 1, 2], pointStarts: [0, 1, 2] },
  { input: "\u2028", units: ["\u2028"], points: ["\u2028"], unitStarts: [0, 1], pointStarts: [0, 1] },
  { input: "zzz", units: ["z", "z", "z"], points: ["z", "z", "z"], unitStarts: [0, 1, 2, 3], pointStarts: [0, 1, 2, 3] }
];
interface PatternHolder { pattern: RegExp }
function inspect<T extends PatternHolder>(holder: T, row: Row, unicode: boolean): void {
  const expression = holder.pattern;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0], starts = unicode ? row.pointStarts : row.unitStarts;
  for (const start of starts) {
    const probe = expression; probe.lastIndex = start; same(probe.lastIndex, start); const hit = probe.exec(row.input); log.push("exec", start, probe.lastIndex);
    if (hit === null) log.push(null); else { same(hit.length, 1); log.push(hit.index, hit[0], hit.input, hit.groups); }
    expected.push("exec", start, start, start, "", row.input, undefined);
  }
  const end = expression; end.lastIndex = row.input.length + 1; const miss = end.exec(row.input); log.push("end", miss, end.lastIndex); expected.push("end", null, 0);
  expression.lastIndex = 7; same(expression.lastIndex, 7); log.push("before", expression.lastIndex);
  const actual = row.input.split(expression), wanted = unicode ? row.points : row.units; log.push("split", expression.lastIndex, actual.length); for (const part of actual) log.push(part);
  expected.push("before", 7, "split", 7, wanted.length); for (const part of wanted) expected.push(part); exact(actual, wanted); exact(log, expected);
}
for (const row of rows) for (const unicode of [false, true]) {
  const literal = unicode ? /(?:)/gu : /(?:)/g; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row, unicode);
}
