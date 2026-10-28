/*---
description: A readonly property retains base-in-sub after a mutable wider write.
features: [ts-unsound-covariant-view, ts-objects, ts-structural-typing, ts-readonly, ts-class, ts-functions, ts-inheritance, ts-class-fields, ts-override]
---*/

// TypeScript assigns a readonly narrow property to a mutable wider property view.
// Writing that alias breaks the original claim; node dispatches using the actual class.
class Base { kind(): string { return "base"; } }
class Sub extends Base { marker: number = 1; override kind(): string { return "sub"; } }
const cell: { readonly value: Sub } = { value: new Sub() };
function overwrite(view: { value: unknown }): void { view.value = new Base(); }
overwrite(cell);
const value: Sub = cell.value;
assert.sameValue(value.kind(), "base");
