/*---
description: An arrow function field keeps its instance when detached; a method does not.
features: [ts-class, ts-class-fields, ts-this]
---*/
class Button {
  label = "ok";
  onClick = (): string => this.label;
  read(): string {
    return this.label;
  }
}
const button = new Button();
const handler = button.onClick;
assert.sameValue(handler(), "ok");
const detached = button.read;
assert.throws(TypeError, () => {
  detached();
});
