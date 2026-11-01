/*---
description: "Control for string-operations-replace-all-empty-callback; A typed replaceAll callback observes every empty match once, including the terminal position."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-arrow-functions, ts-closures, ts-optional-parameters]
---*/
// The callback interface receives an empty capture and no named groups; node advances past zero-length matches and reports UTF-16 offsets without duplicate calls. The control uses fresh literals directly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type Row = { input: string; output: string; offsets: number[] };
const rows: Row[] = [
  { input: "", output: "<0>", offsets: [0] },
  { input: "aba", output: "<0>ab<2>a<3>", offsets: [0, 2, 3] },
  { input: "\ud83d\ude00a", output: "\ud83d\ude00<2>a<3>", offsets: [2, 3] },
  { input: "e\u0301a", output: "e\u0301<2>a<3>", offsets: [2, 3] },
  { input: "\na", output: "\n<1>a<2>", offsets: [1, 2] },
  { input: "\r\na", output: "\r\n<2>a<3>", offsets: [2, 3] },
  { input: "\u2028a", output: "\u2028<1>a<2>", offsets: [1, 2] },
  { input: "zzz", output: "zzz<3>", offsets: [3] }
];
for (const row of rows) for (const repeat of [0, 1]) {
  const expression = /((?=a|$))/g;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0]; expression.lastIndex = 7; log.push("before", expression.lastIndex);
  const output = row.input.replaceAll(expression, (match: string, capture: string, offset: number, input: string, groups?: unknown): string => {
    log.push("callback", match, capture, offset, input, groups, expression.lastIndex); return "<" + offset + ">";
  });
  log.push("replaceAll", output, expression.lastIndex); expected.push("before", 7);
  for (const offset of row.offsets) expected.push("callback", "", "", offset, row.input, undefined, 0);
  expected.push("replaceAll", row.output, 0); same(output, row.output); exact(log, expected);
}
