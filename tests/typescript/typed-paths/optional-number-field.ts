/*---
description: A field typed `number | undefined` holds either, and arithmetic on it is guarded.
features: [ts-null-undefined, ts-numbers, ts-optional-properties]
---*/
type Reading = { value?: number; scale: number };
const readings: Reading[] = [{ value: 2, scale: 10 }, { scale: 5 }, { value: 0, scale: 3 }];
const scaled = readings.map((r) => (r.value === undefined ? -1 : r.value * r.scale));
assert.compareArray(scaled, [20, -1, 0]);
readings[1].value = 1.5;
assert.sameValue(readings[1].value * readings[1].scale, 7.5);
readings[0].value = undefined;
assert.sameValue("value" in readings[0], true);
