/*---
description: "Control for stateful-generic-sticky-test-position; Sticky test calls through a constrained generic retain the exact current position and failure reset."
features: [ts-regexp-routes, ts-regexp-route-stateful, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases]
---*/
// A T extends RegExp parameter carries /[ab]/y; node stops at intervening text and uses the same expression state on the next generic call. The control uses a fresh literal with an independent planned lastIndex before each call, repeated twice.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function check(log: unknown[], expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
type InputRow = { text: string; starts: number[]; expected: unknown[]; count: number };
const rows: InputRow[] = [
  { text: "", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "\ud83d\ude00b", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "e\u0301", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "\n", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "\r\n", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "\u2028", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "xyz", starts: [0, 0, 0, 0], expected: [false, 0, false, 0, false, 0, false, 0], count: 0 },
  { text: "ab", starts: [0, 1, 2, 0], expected: [true, 1, true, 2, false, 0, true, 1], count: 3 },
  { text: "ba", starts: [0, 1, 2, 0], expected: [true, 1, true, 2, false, 0, true, 1], count: 3 },
  { text: "a!b", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "a\ud83d\ude00b", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "a\u0301b", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "a\nb", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "a\r\nb", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 },
  { text: "a\u2028b", starts: [0, 1, 0, 1], expected: [true, 1, false, 0, true, 1, false, 0], count: 2 }
];
function inspect(row: InputRow): void {
  for (const repeat of [0, 1]) {
    const log: unknown[] = []; let count = 0;
    for (let i = 0; i < 4; i++) { const direct = /[ab]/y; direct.lastIndex = row.starts[i]; const found = direct.test(row.text); log.push(found, direct.lastIndex); if (found) count++; }
    same(count, row.count); check(log, row.expected);
  }
}
for (const row of rows) inspect(row);
