/*---
description: An array element retains base-in-sub through a covariant write.
features: [ts-unsound-covariant-array, ts-arrays, ts-class, ts-functions, ts-structural-typing, ts-inheritance, ts-class-fields, ts-override]
---*/

// TypeScript permits a wider mutable array alias to replace this initialized slot.
// Its narrow element claim is then false; node dispatches using the actual class.
class Base { kind(): string { return "base"; } }
class Sub extends Base { marker: number = 1; override kind(): string { return "sub"; } }
const values: Sub[] = [new Sub()];
const wide: unknown[] = values;
wide[0] = new Base();
const value: Sub = values[0];
assert.sameValue(value.kind(), "base");
