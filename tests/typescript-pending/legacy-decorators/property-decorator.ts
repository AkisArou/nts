/*---
description: A legacy property decorator receives the prototype and the key, once, when the class is defined.
features: [ts-legacy-decorators, ts-class, ts-class-fields]
---*/
const required = new Map<object, string[]>();
function mandatory(target: object, key: string): void {
  const keys = required.get(target) ?? [];
  keys.push(key);
  required.set(target, keys);
}
class Form {
  @mandatory email = "";
  @mandatory password = "";
  note = "";
}
new Form();
new Form();
assert.compareArray(required.get(Form.prototype) ?? [], ["email", "password"]);
assert.sameValue(required.size, 1);
