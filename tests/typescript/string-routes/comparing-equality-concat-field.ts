/*---
description: Concatenated field strings equal sliced strings with identical code units.
features: [ts-string-route-comparing, ts-strings, ts-interfaces, ts-objects]
---*/
// Route: a concatenated string field compared with a sliced local; node preserves the exact UTF-16 result.
interface RouteSample { left: string; right: string; input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { left: "", right: "", input: "", expected: "", size: 0, first: NaN, last: NaN },
  { left: "a", right: "bc", input: "abc", expected: "abc", size: 3, first: 97, last: 99 },
  { left: "\u00e9", right: "\u00df\u00ff", input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { left: "\u0101", right: "", input: "\u0101", expected: "\u0101", size: 1, first: 257, last: 257 },
  { left: "\u4e2d", right: "", input: "\u4e2d", expected: "\u4e2d", size: 1, first: 20013, last: 20013 },
  { left: "\ud83d", right: "\ude00", input: "\ud83d\ude00", expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { left: "\ud800", right: "", input: "\ud800", expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { left: "\udfff", right: "", input: "\udfff", expected: "\udfff", size: 1, first: 57343, last: 57343 },
  { left: "\u0101", right: "ab", input: "\u0101ab", expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { left: "a", right: "\u0101b", input: "a\u0101b", expected: "a\u0101b", size: 3, first: 97, last: 98 },
  { left: "a", right: "b\u0101", input: "ab\u0101", expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { left: "a", right: "\ud83d\ude00b", input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b", size: 4, first: 97, last: 98 },
  { left: "\u00e9", right: "\u0101\u00ff", input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff", size: 3, first: 233, last: 255 },
];
interface ConcatStringSlot { text: string; }
for (const row of samples) {
  const slot: ConcatStringSlot = { text: row.left };
  slot.text += row.right; const actual: string = slot.text;
  const probe: string = ("!" + row.input + "?").slice(1, -1);
  assert.sameValue(actual, row.expected);
  assert.sameValue(actual.length, row.size);
  assert.sameValue(actual.charCodeAt(0), row.first);
  assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
  assert.sameValue(probe, row.expected);
  assert.sameValue(probe.length, row.size);
  assert.sameValue(probe.charCodeAt(0), row.first);
  assert.sameValue(probe.charCodeAt(probe.length - 1), row.last);
  assert.sameValue(actual === probe, true);
  assert.sameValue(actual === probe + "\u0000", false);
}
