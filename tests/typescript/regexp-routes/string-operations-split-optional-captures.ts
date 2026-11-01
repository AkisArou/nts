/*---
description: "A generic RegExp holder preserves inserted split captures, including unmatched captures and empty edge fragments."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// Comma or semicolon captures enter the result array between substrings; node distinguishes undefined captures from empty string fragments and keeps the original lastIndex.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Probe = [number, number, number, string | null, (string | undefined)[]];
type Row = { input: string; parts: (string | undefined)[]; probes: Probe[] };
const rows: Row[] = [
  { input: "", parts: [""], probes: [[0, 0, -1, null, []]] },
  { input: "a,b;c", parts: ["a", ",", undefined, "b", undefined, ";", "c"], probes: [[0, 2, 1, ",", [",", undefined]], [2, 4, 3, ";", [undefined, ";"]], [4, 0, -1, null, []]] },
  { input: "\ud83d\ude00,x", parts: ["\ud83d\ude00", ",", undefined, "x"], probes: [[0, 3, 2, ",", [",", undefined]], [3, 0, -1, null, []]] },
  { input: "e\u0301;x", parts: ["e\u0301", undefined, ";", "x"], probes: [[0, 3, 2, ";", [undefined, ";"]], [3, 0, -1, null, []]] },
  { input: "\na,b", parts: ["\na", ",", undefined, "b"], probes: [[0, 3, 2, ",", [",", undefined]], [3, 0, -1, null, []]] },
  { input: "\r\n;a", parts: ["\r\n", undefined, ";", "a"], probes: [[0, 3, 2, ";", [undefined, ";"]], [3, 0, -1, null, []]] },
  { input: "\u2028,a", parts: ["\u2028", ",", undefined, "a"], probes: [[0, 2, 1, ",", [",", undefined]], [2, 0, -1, null, []]] },
  { input: "zzz", parts: ["zzz"], probes: [[0, 0, -1, null, []]] },
  { input: ",;", parts: ["", ",", undefined, "", undefined, ";", ""], probes: [[0, 1, 0, ",", [",", undefined]], [1, 2, 1, ";", [undefined, ";"]], [2, 0, -1, null, []]] }
];
interface PatternHolder { pattern: RegExp }
function inspect<T extends PatternHolder>(holder: T, row: Row): void {
  const expression = holder.pattern;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0];
  for (const probe of row.probes) {
    const probeRegex = expression; probeRegex.lastIndex = probe[0]; same(probeRegex.lastIndex, probe[0]);
    const before = probeRegex.lastIndex, hit = probeRegex.exec(row.input); log.push("exec", before, probeRegex.lastIndex);
    if (hit === null) log.push(null); else { log.push(hit.index, hit[0], hit.input); same(hit.length, probe[4].length + 1); for (let at = 1; at < hit.length; at++) log.push(hit[at]); log.push(hit.groups); }
    expected.push("exec", probe[0], probe[1]); if (probe[3] === null) expected.push(null); else { expected.push(probe[2], probe[3], row.input); for (const capture of probe[4]) expected.push(capture); expected.push(undefined); }
  }
  expression.lastIndex = 7; same(expression.lastIndex, 7); log.push("before", expression.lastIndex);
  const actual = row.input.split(expression); log.push("split", expression.lastIndex, actual.length); for (const part of actual) log.push(part);
  expected.push("before", 7, "split", 7, row.parts.length); for (const part of row.parts) expected.push(part); exact(actual, row.parts); exact(log, expected);
}
for (const row of rows) {
  const literal = /(,)|(;)/g; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
