/*---
description: Control for comparing-sort-interface-layouts; strings read through different interface layouts sort by UTF-16 units.
features: [ts-string-route-comparing, ts-strings, ts-interfaces, ts-class, ts-class-fields, ts-arrays]
---*/
// Control: plain local strings replace string fields read through an interface before default sort; node preserves the exact UTF-16 result.
interface RouteSample { input: string; expected: string; size: number; first: number; last: number; }
const samples: RouteSample[] = [
  { input: "Z", expected: "Z", size: 1, first: 90, last: 90 },
  { input: "a", expected: "a", size: 1, first: 97, last: 97 },
  { input: "\u00e9", expected: "\u00e9", size: 1, first: 233, last: 233 },
  { input: "e\u0301", expected: "e\u0301", size: 2, first: 101, last: 769 },
  { input: "\ue000", expected: "\ue000", size: 1, first: 57344, last: 57344 },
  { input: "", expected: "", size: 0, first: NaN, last: NaN },
  { input: "abc", expected: "abc", size: 3, first: 97, last: 99 },
  { input: "\u00e9\u00df\u00ff", expected: "\u00e9\u00df\u00ff", size: 3, first: 233, last: 255 },
  { input: "\u0101", expected: "\u0101", size: 1, first: 257, last: 257 },
  { input: "\u4e2d", expected: "\u4e2d", size: 1, first: 20013, last: 20013 },
  { input: "\ud83d\ude00", expected: "\ud83d\ude00", size: 2, first: 55357, last: 56832 },
  { input: "\ud800", expected: "\ud800", size: 1, first: 55296, last: 55296 },
  { input: "\udfff", expected: "\udfff", size: 1, first: 57343, last: 57343 },
  { input: "\u0101ab", expected: "\u0101ab", size: 3, first: 257, last: 98 },
  { input: "a\u0101b", expected: "a\u0101b", size: 3, first: 97, last: 98 },
  { input: "ab\u0101", expected: "ab\u0101", size: 3, first: 97, last: 257 },
  { input: "a\ud83d\ude00b", expected: "a\ud83d\ude00b", size: 4, first: 97, last: 98 },
  { input: "\u00e9\u0101\u00ff", expected: "\u00e9\u0101\u00ff", size: 3, first: 233, last: 255 },
];
const ordered = [samples[5], samples[0], samples[1], samples[6], samples[15], samples[14], samples[16], samples[3], samples[2], samples[7], samples[17], samples[8], samples[13], samples[9], samples[11], samples[10], samples[12], samples[4]];
interface OrderedStringView { text: string; }
class LeadingStringView implements OrderedStringView { text: string = ""; marker: number = 1; }
class TrailingStringView implements OrderedStringView { marker: number = 2; text: string = ""; }
for (const reverse of [false, true]) for (const alternate of [false, true]) {
  const values: string[] = [];
  for (const row of reverse ? [...samples].reverse() : samples) {
    let slot: string = "";
    slot = row.input; const value: string = slot;
    assert.sameValue(value, row.expected); assert.sameValue(value.length, row.size);
    assert.sameValue(value.charCodeAt(0), row.first); assert.sameValue(value.charCodeAt(value.length - 1), row.last);
    values.push(value);
  }
  values.sort(); assert.sameValue(values.length, ordered.length);
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index]; const actual: string = values[index];
    assert.sameValue(actual, row.expected); assert.sameValue(actual.length, row.size);
    assert.sameValue(actual.charCodeAt(0), row.first); assert.sameValue(actual.charCodeAt(actual.length - 1), row.last);
  }
}
