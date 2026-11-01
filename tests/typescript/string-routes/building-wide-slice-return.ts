/*---
description: A constructed wide string yields only Latin-1 units through a declared slice-result return.
features: [ts-string-route-building, ts-strings, ts-functions]
---*/
// Route: a declared string return after slicing a wide construction; node retains the exact UTF-16 text, length and endpoint code units.
function narrowBuilt(value: string, start: number, end: number): string { return value.slice(start, end); }
interface BuildingSample { left: string; middle: string; right: string; start: number; end: number; built: string; builtSize: number; builtFirst: number; builtLast: number; expected: string; size: number; first: number; last: number; }
const rows: BuildingSample[] = [
  { left: "", middle: "", right: "", start: 0, end: 0, built: "", builtSize: 0, builtFirst: NaN, builtLast: NaN, expected: "", size: 0, first: NaN, last: NaN },
  { left: "x", middle: "ab", right: "y", start: 1, end: 3, built: "xaby", builtSize: 4, builtFirst: 120, builtLast: 121, expected: "ab", size: 2, first: 97, last: 98 },
  { left: "\u0101", middle: "", right: "\u4e2d", start: 1, end: 1, built: "\u0101\u4e2d", builtSize: 2, builtFirst: 257, builtLast: 20013, expected: "", size: 0, first: NaN, last: NaN },
  { left: "\u0101", middle: "ab", right: "\u4e2d", start: 1, end: 3, built: "\u0101ab\u4e2d", builtSize: 4, builtFirst: 257, builtLast: 20013, expected: "ab", size: 2, first: 97, last: 98 },
  { left: "\u4e2d", middle: "\u00e9\u00df\u00ff", right: "\u0101", start: 1, end: 4, built: "\u4e2d\u00e9\u00df\u00ff\u0101", builtSize: 5, builtFirst: 20013, builtLast: 257, expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { left: "\ud83d\ude00", middle: "ab", right: "\ud83d\ude00", start: 2, end: 4, built: "\ud83d\ude00ab\ud83d\ude00", builtSize: 6, builtFirst: 55357, builtLast: 56832, expected: "ab", size: 2, first: 97, last: 98 },
  { left: "\ud800", middle: "\u00e9", right: "\udc00", start: 1, end: 2, built: "\ud800\u00e9\udc00", builtSize: 3, builtFirst: 55296, builtLast: 56320, expected: "\u00e9", size: 1, first: 233, last: 233 },
  { left: "\udc00", middle: "\u00df\u00ff", right: "\ud800", start: 1, end: 3, built: "\udc00\u00df\u00ff\ud800", builtSize: 4, builtFirst: 56320, builtLast: 55296, expected: "\u00df\u00ff", size: 2, first: 223, last: 255 },
  { left: "a\u4e2d", middle: "bc", right: "", start: 2, end: 4, built: "a\u4e2dbc", builtSize: 4, builtFirst: 97, builtLast: 99, expected: "bc", size: 2, first: 98, last: 99 },
  { left: "", middle: "ab", right: "\u4e2dx", start: 0, end: 2, built: "ab\u4e2dx", builtSize: 4, builtFirst: 97, builtLast: 120, expected: "ab", size: 2, first: 97, last: 98 },
  { left: "\u4e2d", middle: "a\u0000\u00ff", right: "z", start: 1, end: 4, built: "\u4e2da\u0000\u00ffz", builtSize: 5, builtFirst: 20013, builtLast: 122, expected: "a\u0000\u00ff", size: 3, first: 97, last: 255 },
  { left: "\u0101", middle: "\u00ff", right: "", start: 1, end: 2, built: "\u0101\u00ff", builtSize: 2, builtFirst: 257, builtLast: 255, expected: "\u00ff", size: 1, first: 255, last: 255 },
  { left: "", middle: "\u00e9", right: "\u4e2d", start: 0, end: 1, built: "\u00e9\u4e2d", builtSize: 2, builtFirst: 233, builtLast: 20013, expected: "\u00e9", size: 1, first: 233, last: 233 },
  { left: "\ud83d\ude00", middle: "", right: "", start: 2, end: 2, built: "\ud83d\ude00", builtSize: 2, builtFirst: 55357, builtLast: 56832, expected: "", size: 0, first: NaN, last: NaN },
];
function checkText(actual: string, expected: string, size: number, first: number, last: number): void {
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, "string");
  assert.sameValue(actual.length, size);
  assert.sameValue(actual.charCodeAt(0), first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), last);
}
for (const row of rows) {
  const built: string = row.left + row.middle + row.right;
  checkText(built, row.built, row.builtSize, row.builtFirst, row.builtLast);
  const result: string = narrowBuilt(built, row.start, row.end);
  checkText(result, row.expected, row.size, row.first, row.last);
}
