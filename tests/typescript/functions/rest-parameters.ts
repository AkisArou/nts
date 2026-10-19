/*---
description: A rest parameter collects the remaining arguments into a real array, empty when there are none.
features: [ts-functions, ts-rest-parameters]
---*/
function tally(label: string, ...counts: number[]): string {
  return `${label}:${counts.length}:${counts.reduce((a, b) => a + b, 0)}`;
}
assert.sameValue(tally("none"), "none:0:0");
assert.sameValue(tally("some", 1, 2, 3), "some:3:6");
const extra = [4, 5];
assert.sameValue(tally("spread", ...extra, 6), "spread:3:15");
