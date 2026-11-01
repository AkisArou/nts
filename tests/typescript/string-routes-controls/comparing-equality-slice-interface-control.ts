/*---
description: Control for comparing-equality-slice-interface; sliced strings through two interface layouts equal repeated strings.
features: [ts-string-route-comparing, ts-strings, ts-interfaces, ts-class, ts-class-fields]
---*/
// Control: plain local strings replace a sliced string through an interface over two class layouts; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "", expected: "", size: 0, first: NaN, last: NaN },
  { input: "abc", expected: "abcabc", size: 6, first: 97, last: 99 },
  { input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff\u00e9\u00df\u00ff", size: 6, first: 233, last: 255 },
  { input: "\u0101", expected: "\u0101\u0101", size: 2, first: 257, last: 257 },
  { input: "\u4e2d", expected: "\u4e2d\u4e2d", size: 2, first: 20013, last: 20013 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00\ud83d\ude00", size: 4, first: 55357, last: 56832 },
  { input: "\ud800", expected: "\ud800\ud800", size: 2, first: 55296, last: 55296 },
  { input: "\udfff", expected: "\udfff\udfff", size: 2, first: 57343, last: 57343 },
  { input: "\u0101ab", expected: "\u0101ab\u0101ab", size: 6, first: 257, last: 98 },
  { input: "a\u0101b", expected: "a\u0101ba\u0101b", size: 6, first: 97, last: 98 },
  { input: "ab\u0101", expected: "ab\u0101ab\u0101", size: 6, first: 97, last: 257 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00ba\ud83d\ude00b", size: 8, first: 97, last: 98 },
  { input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff\u00e9\u0101\u00ff", size: 6, first: 233, last: 255 },
];
interface OrderedStringView { text: string; }
class LeadingStringView implements OrderedStringView { text: string = ""; marker: number = 1; }
class TrailingStringView implements OrderedStringView { marker: number = 2; text: string = ""; }
for (const row of samples) for (const alternate of [false, true]) {
  let slot: string = "";
  slot = ("!" + row.input + row.input + "?").slice(1, -1); const actual: string = slot;
  const probe: string = row.input.repeat(2);
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
