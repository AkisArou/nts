/*---
description: Assigning to a union-typed variable narrows it to the assigned member until the next assignment.
features: [ts-unions, ts-narrowing]
---*/
let value: number | string = "start";
const lengths: number[] = [value.length];
value = 41;
lengths.push(value + 1);
value = "end!";
lengths.push(value.length);
assert.compareArray(lengths, [5, 42, 4]);
