/*---
description: A readonly property retains number-in-boolean after a mutable wider write.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-readonly, ts-functions]
---*/

// TypeScript assigns a readonly narrow property to a mutable wider property view.
// Writing that alias breaks the original claim; node preserves the actual value and its conversions.
const cell: { readonly value: boolean } = { value: false };
function overwrite(view: { value: unknown }): void { view.value = 7; }
overwrite(cell);
const value: boolean = cell.value;
assert.sameValue(typeof value, "number");
assert.sameValue(String(value), "7");
assert.sameValue(JSON.stringify(value), "7");
