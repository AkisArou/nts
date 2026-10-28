/*---
description: A readonly property retains same-shape-class after a mutable wider write.
features: [ts-unsound-covariant-view, ts-objects, ts-structural-typing, ts-readonly, ts-class, ts-functions]
---*/

// TypeScript accepts these same-shaped classes through a mutable wider property view.
// The declared class name differs from the instance; node dispatches by its actual class.
class First { kind(): string { return "first"; } }
class Second { kind(): string { return "second"; } }
const cell: { readonly value: First } = { value: new First() };
function overwrite(view: { value: unknown }): void { view.value = new Second(); }
overwrite(cell);
const value: First = cell.value;
assert.sameValue(value.kind(), "second");
