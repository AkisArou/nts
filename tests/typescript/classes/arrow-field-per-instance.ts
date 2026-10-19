/*---
description: An arrow function field is a new function per instance; a method is one function on the prototype.
features: [ts-class, ts-class-fields]
---*/
class Widget {
  handle = (): number => 1;
  method(): number {
    return 2;
  }
}
const a = new Widget();
const b = new Widget();
assert.sameValue(a.handle === b.handle, false);
assert.sameValue(a.method === b.method, true);
assert.sameValue(Object.keys(a).join(","), "handle");
