/*---
description: A mutable numeric object property preserves an aliased string through a spread copy.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-spread, ts-structural-typing]
---*/
// TypeScript treats the mutable number property covariantly, so a wider
// property alias can store a string. Node reads that string through the
// original numeric reference.
const cell: { value: number } = { value: 2 };
const writer: { value: unknown } = cell;
writer.value = "7";
const copied = { ...cell };
assert.sameValue(typeof copied.value, "string");
assert.sameValue(String(copied.value + 1), "71");
assert.sameValue(JSON.stringify(copied), '{"value":"7"}');
