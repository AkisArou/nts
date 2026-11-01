/*---
description: "Control for string-operations-replace-all-context-tokens; A typed RegExp field preserves replaceAll substitution tokens, original context and optional captures."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// Literal and constructed patterns cross the same generic holder; node expands all seven replacement forms while exact exec probes expose captures and UTF-16 indices. The control uses fresh literals directly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Probe = [number, number, number, string | null, (string | undefined)[]];
type Row = { input: string; output: string; probes: Probe[] };
const rows: Row[] = [
  { input: "", output: "", probes: [[0, 0, -1, null, []]] },
  { input: "aba", output: "<ab|a|b|a||a|$><a|a||a|ab||$>", probes: [[0, 2, 0, "ab", ["a", "b"]], [2, 3, 2, "a", ["a", undefined]], [3, 0, -1, null, []]] },
  { input: "\ud83d\ude00a", output: "\ud83d\ude00<a|a||a|\ud83d\ude00||$>", probes: [[0, 3, 2, "a", ["a", undefined]], [3, 0, -1, null, []]] },
  { input: "e\u0301ab", output: "e\u0301<ab|a|b|a|e\u0301||$>", probes: [[0, 4, 2, "ab", ["a", "b"]], [4, 0, -1, null, []]] },
  { input: "\na", output: "\n<a|a||a|\n||$>", probes: [[0, 2, 1, "a", ["a", undefined]], [2, 0, -1, null, []]] },
  { input: "\r\nab", output: "\r\n<ab|a|b|a|\r\n||$>", probes: [[0, 4, 2, "ab", ["a", "b"]], [4, 0, -1, null, []]] },
  { input: "\u2028a", output: "\u2028<a|a||a|\u2028||$>", probes: [[0, 2, 1, "a", ["a", undefined]], [2, 0, -1, null, []]] },
  { input: "zzz", output: "zzz", probes: [[0, 0, -1, null, []]] }
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
  expression.lastIndex = 7; same(expression.lastIndex, 7); log.push("before", expression.lastIndex);
  const output = row.input.replaceAll(expression, "<$&|$1|$2|$<word>|$`|$'|$$>"); log.push("replaceAll", output, expression.lastIndex);
  expected.push("before", 7, "replaceAll", row.output, 0); same(output, row.output); exact(log, expected);
}
