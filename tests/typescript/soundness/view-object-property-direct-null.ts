/*---
description: A readonly property retains null after a mutable wider write.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-readonly, ts-null-undefined, ts-functions]
---*/

// TypeScript assigns a readonly narrow property to a mutable wider property view.
// Writing that alias breaks the original claim; node preserves the actual value and its conversions.
const cell: { readonly value: number } = { value: 1 };
function overwrite(view: { value: unknown }): void { view.value = null; }
overwrite(cell);
const value: number = cell.value;
assert.sameValue<unknown>(value, null);
assert.sameValue(typeof value, "object");
assert.sameValue(String(value), "null");
