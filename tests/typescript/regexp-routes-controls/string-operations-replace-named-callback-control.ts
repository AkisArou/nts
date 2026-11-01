/*---
description: "Control for string-operations-replace-named-callback; An interface-typed replacement callback receives exact named captures, offsets and original input through a RegExp holder."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-index-signatures, ts-arrow-functions, ts-closures]
---*/
// The callback records every argument and returns literal dollar text; node preserves undefined versus empty captures and does not re-expand callback output. The control uses fresh literals directly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Call = [number, string, string | undefined, string];
type Row = { input: string; output: string; calls: Call[] };
const rows: Row[] = [
  { input: "", output: "", calls: [] },
  { input: "abc c ac", output: "$&0:a:b; $&4:undefined:; $&6:a:;", calls: [[0, "abc", "a", "b"], [4, "c", undefined, ""], [6, "ac", "a", ""]] },
  { input: "\ud83d\ude00c", output: "\ud83d\ude00$&2:undefined:;", calls: [[2, "c", undefined, ""]] },
  { input: "e\u0301ac", output: "e\u0301$&2:a:;", calls: [[2, "ac", "a", ""]] },
  { input: "\nc", output: "\n$&1:undefined:;", calls: [[1, "c", undefined, ""]] },
  { input: "\r\nbc", output: "\r\n$&2:undefined:b;", calls: [[2, "bc", undefined, "b"]] },
  { input: "\u2028c", output: "\u2028$&1:undefined:;", calls: [[1, "c", undefined, ""]] },
  { input: "zzz", output: "zzz", calls: [] }
];
for (const row of rows) for (const repeat of [0, 1]) {
  const expression = /(?<letter>a)?(b*)c/g;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0]; expression.lastIndex = 7; log.push("before", expression.lastIndex);
  const output = row.input.replace(expression, (match: string, letter: string | undefined, tail: string, offset: number, input: string, groups: { [key: string]: string | undefined }): string => {
    exact(Object.keys(groups), ["letter"]); log.push("callback", match, letter, tail, offset, input, groups.letter, expression.lastIndex);
    return "$&" + offset + ":" + String(letter) + ":" + tail + ";";
  });
  log.push("replace", output, expression.lastIndex);
  expected.push("before", 7); for (const call of row.calls) expected.push("callback", call[1], call[2], call[3], call[0], row.input, call[2], 0);
  expected.push("replace", row.output, 0); same(output, row.output); exact(log, expected);
}
