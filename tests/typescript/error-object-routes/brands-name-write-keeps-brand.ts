/*---
description: "Name writes do not change internal branding or make a message-shaped record into an Error through a structural interface array."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-interfaces]
flags: [module]
---*/
// Name writes do not change internal branding or make a message-shaped record into an Error; route: a structural interface array.
// Node prints: brands-name-write-keeps-brand:ok
interface Named { name: string; message: string; }
const values: readonly Named[] = [new Error("message"), { name: "Error", message: "message" }];
const keys: readonly (readonly string[])[] = [["name"], ["name", "message"]];
for (let index = 0; index < values.length; index++) {
  const value: Named = values[index];
  for (const name of ["", "TypeError", "custom"]) {
    value.name = name;
    assert.sameValue(value.name, name); assert.sameValue(value.message, "message");
    assert.sameValue(Error.isError(value), index === 0);
    assert.sameValue(Object.hasOwn(value, "name"), true); assert.sameValue(Object.hasOwn(value, "message"), true);
    assert.compareArray(Object.keys(value), keys[index]);
  }
}
console.log("brands-name-write-keeps-brand:ok");
