/*---
description: A legacy accessor decorator receives the accessor pair's descriptor and may make it enumerable or wrap its getter.
features: [ts-legacy-decorators, ts-class, ts-accessors]
---*/
function visible(_target: object, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const get = descriptor.get!;
  return { ...descriptor, enumerable: true, get(this: unknown) { return `[${get.call(this)}]`; } };
}
class Temperature {
  constructor(private celsius: number) {}
  @visible
  get display(): string {
    return `${this.celsius}C`;
  }
}
assert.sameValue(new Temperature(20).display, "[20C]");
assert.sameValue(Object.getOwnPropertyDescriptor(Temperature.prototype, "display")?.enumerable, true);
