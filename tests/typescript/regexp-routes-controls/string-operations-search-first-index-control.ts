/*---
description: "Control for string-operations-search-first-index; Searching through a generic RegExp holder returns the first UTF-16 index and restores the exact supplied state."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// The global regex arrives with negative zero, a later index or NaN; node searches from zero, reports -1 on failure and restores lastIndex with its original identity. The control uses fresh literals directly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Probe = [number, number, number, string | null, (string | undefined)[]];
type Row = { input: string; index: number; probes: Probe[] };
const rows: Row[] = [
  { input: "", index: -1, probes: [[0, 0, -1, null, []]] },
  { input: "zab", index: 1, probes: [[0, 3, 1, "ab", ["a", "b"]]] },
  { input: "\ud83d\ude00a", index: 2, probes: [[0, 3, 2, "a", ["a", undefined]]] },
  { input: "e\u0301ab", index: 2, probes: [[0, 4, 2, "ab", ["a", "b"]]] },
  { input: "\na", index: 1, probes: [[0, 2, 1, "a", ["a", undefined]]] },
  { input: "\r\nab", index: 2, probes: [[0, 4, 2, "ab", ["a", "b"]]] },
  { input: "\u2028a", index: 1, probes: [[0, 2, 1, "a", ["a", undefined]]] },
  { input: "zzz", index: -1, probes: [[0, 0, -1, null, []]] }
];
for (const row of rows) for (const repeat of [0, 1]) {
  const expression = /(?<word>a)(b)?/g;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0];
  for (const probe of row.probes) {
    const probeRegex = /(?<word>a)(b)?/g; probeRegex.lastIndex = probe[0]; same(probeRegex.lastIndex, probe[0]);
    const before = probeRegex.lastIndex, hit = probeRegex.exec(row.input); log.push("exec", before, probeRegex.lastIndex);
    if (hit === null) log.push(null); else { log.push(hit.index, hit[0], hit.input); same(hit.length, probe[4].length + 1); for (let at = 1; at < hit.length; at++) log.push(hit[at]); const groups = hit.groups; if (groups === undefined) throw new Error("missing groups"); exact(Object.keys(groups), ["word"]); log.push(groups.word); }
    expected.push("exec", probe[0], probe[1]); if (probe[3] === null) expected.push(null); else { expected.push(probe[2], probe[3], row.input); for (const capture of probe[4]) expected.push(capture); expected.push(probe[4][0]); }
  }
  for (const start of [-0, 5, NaN]) {
    const target = /(?<word>a)(b)?/g; target.lastIndex = start; same(target.lastIndex, start); log.push("before", target.lastIndex);
    const index = row.input.search(target); log.push("search", index, target.lastIndex); expected.push("before", start, "search", row.index, start); same(index, row.index);
  }
  exact(log, expected);
}
