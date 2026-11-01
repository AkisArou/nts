/*---
description: Control for comparing-order-parameters; typed string parameters compare in UTF-16 code-unit order.
features: [ts-string-route-comparing, ts-strings, ts-functions]
---*/
// Control: plain local strings replace two string parameters into a relational comparison; node preserves the exact UTF-16 result.
interface RouteSample { left: string; right: string; expected: boolean; lsize: number; lfirst: number; llast: number; rsize: number; rfirst: number; rlast: number; }
const samples: RouteSample[] = [
  { left: "", right: "", expected: false, lsize: 0, lfirst: NaN, llast: NaN, rsize: 0, rfirst: NaN, rlast: NaN },
  { left: "", right: "abc", expected: true, lsize: 0, lfirst: NaN, llast: NaN, rsize: 3, rfirst: 97, rlast: 99 },
  { left: "Z", right: "a", expected: true, lsize: 1, lfirst: 90, llast: 90, rsize: 1, rfirst: 97, rlast: 97 },
  { left: "a", right: "Z", expected: false, lsize: 1, lfirst: 97, llast: 97, rsize: 1, rfirst: 90, rlast: 90 },
  { left: "\u00e9", right: "e\u0301", expected: false, lsize: 1, lfirst: 233, llast: 233, rsize: 2, rfirst: 101, rlast: 769 },
  { left: "\u00e9\u00df\u00ff", right: "\u0101", expected: true, lsize: 3, lfirst: 233, llast: 255, rsize: 1, rfirst: 257, rlast: 257 },
  { left: "\u4e2d", right: "\u0101", expected: false, lsize: 1, lfirst: 20013, llast: 20013, rsize: 1, rfirst: 257, rlast: 257 },
  { left: "\ud83d\ude00", right: "\ue000", expected: true, lsize: 2, lfirst: 55357, llast: 56832, rsize: 1, rfirst: 57344, rlast: 57344 },
  { left: "\ud800", right: "\ud83d\ude00", expected: true, lsize: 1, lfirst: 55296, llast: 55296, rsize: 2, rfirst: 55357, rlast: 56832 },
  { left: "\udfff", right: "\ud83d\ude00", expected: false, lsize: 1, lfirst: 57343, llast: 57343, rsize: 2, rfirst: 55357, rlast: 56832 },
  { left: "\u0101ab", right: "a\u0101b", expected: false, lsize: 3, lfirst: 257, llast: 98, rsize: 3, rfirst: 97, rlast: 98 },
  { left: "a\u0101b", right: "ab\u0101", expected: false, lsize: 3, lfirst: 97, llast: 98, rsize: 3, rfirst: 97, rlast: 257 },
  { left: "ab\u0101", right: "ab\u00ff", expected: false, lsize: 3, lfirst: 97, llast: 257, rsize: 3, rfirst: 97, rlast: 255 },
  { left: "a\ud83d\ude00b", right: "a\udfff", expected: true, lsize: 4, lfirst: 97, llast: 98, rsize: 2, rfirst: 97, rlast: 57343 },
];
function lessRouteString(left: string, right: string): boolean { return left < right; }
for (const row of samples) {
  const left: string = row.left; const right: string = row.right;
  const actual: boolean = left < right;
  assert.sameValue(actual, row.expected);
  assert.sameValue(left, row.left); assert.sameValue(right, row.right);
  assert.sameValue(left.length, row.lsize); assert.sameValue(right.length, row.rsize);
  assert.sameValue(left.charCodeAt(0), row.lfirst); assert.sameValue(right.charCodeAt(0), row.rfirst);
  assert.sameValue(left.charCodeAt(left.length - 1), row.llast); assert.sameValue(right.charCodeAt(right.length - 1), row.rlast);
}
