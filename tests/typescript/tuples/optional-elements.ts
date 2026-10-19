/*---
description: An optional tuple element may be absent; the tuple's length says whether it is there.
features: [ts-tuples, ts-tuple-optional]
---*/
type Interval = [start: number, end?: number];
function width(interval: Interval): number {
  const [start, end] = interval;
  return end === undefined ? 1 : end - start;
}
const single: Interval = [4];
const bounded: Interval = [2, 9];
assert.sameValue(width(single), 1);
assert.sameValue(width(bounded), 7);
assert.sameValue(single.length, 1);
assert.sameValue(bounded.length, 2);
