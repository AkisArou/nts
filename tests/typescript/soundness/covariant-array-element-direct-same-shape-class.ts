/*---
description: An array element retains same-shape-class through a covariant write.
features: [ts-unsound-covariant-array, ts-arrays, ts-class, ts-functions, ts-structural-typing]
---*/

// TypeScript accepts these same-shaped classes through a wider array alias.
// The declared class name differs from the instance; node dispatches by its actual class.
class First { kind(): string { return "first"; } }
class Second { kind(): string { return "second"; } }
const values: First[] = [new First()];
const wide: unknown[] = values;
wide[0] = new Second();
const value: First = values[0];
assert.sameValue(value.kind(), "second");
