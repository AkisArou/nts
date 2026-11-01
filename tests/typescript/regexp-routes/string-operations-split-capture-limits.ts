/*---
description: "Typed split limits truncate between substring and capture entries and use the specified integer conversion."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// A RegExp field and number-or-undefined limits share one consumer; node counts inserted captures toward the limit and preserves lastIndex for every call.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Probe = [number, number, number, string | null, (string | undefined)[]];
type Row = { input: string; parts: string[]; probes: Probe[] };
const rows: Row[] = [
  { input: "", parts: [""], probes: [[0, 0, -1, null, []]] },
  { input: "a,b;c", parts: ["a", ",", "b", ";", "c"], probes: [[0, 2, 1, ",", [","]], [2, 4, 3, ";", [";"]], [4, 0, -1, null, []]] },
  { input: "\ud83d\ude00,x", parts: ["\ud83d\ude00", ",", "x"], probes: [[0, 3, 2, ",", [","]], [3, 0, -1, null, []]] },
  { input: "e\u0301;x", parts: ["e\u0301", ";", "x"], probes: [[0, 3, 2, ";", [";"]], [3, 0, -1, null, []]] },
  { input: "\na,b", parts: ["\na", ",", "b"], probes: [[0, 3, 2, ",", [","]], [3, 0, -1, null, []]] },
  { input: "\r\n;a", parts: ["\r\n", ";", "a"], probes: [[0, 3, 2, ";", [";"]], [3, 0, -1, null, []]] },
  { input: "\u2028,a", parts: ["\u2028", ",", "a"], probes: [[0, 2, 1, ",", [","]], [2, 0, -1, null, []]] },
  { input: "zzz", parts: ["zzz"], probes: [[0, 0, -1, null, []]] }
];
const limits: [number | undefined, number][] = [[0, 0], [-0, 0], [NaN, 0], [1, 1], [2, 2], [3, 3], [4, 4], [4294967296, 0], [-1, 99], [undefined, 99]];
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
  for (const limit of limits) {
    const target = expression; target.lastIndex = 7; same(target.lastIndex, 7); log.push("before", limit[0], target.lastIndex);
    const actual = row.input.split(target, limit[0]), wanted = row.parts.slice(0, limit[1]); log.push("split", target.lastIndex, actual.length); for (const part of actual) log.push(part);
    expected.push("before", limit[0], 7, "split", 7, wanted.length); for (const part of wanted) expected.push(part); exact(actual, wanted);
  }
  exact(log, expected);
}
for (const row of rows) {
  const literal = /([,;])/g; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
