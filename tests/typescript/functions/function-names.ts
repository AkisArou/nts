/*---
description: A function's name comes from its declaration, its binding, or the property it is defined as.
features: [ts-functions, ts-arrow-functions]
---*/
function declared(): void {}
const arrow = (): void => {};
const expression = function (): void {};
const named = function inner(): void {};
const holder = { method(): void {}, field: (): void => {} };
assert.sameValue(declared.name, "declared");
assert.sameValue(arrow.name, "arrow");
assert.sameValue(expression.name, "expression");
assert.sameValue(named.name, "inner");
assert.sameValue(holder.method.name, "method");
assert.sameValue(holder.field.name, "field");
