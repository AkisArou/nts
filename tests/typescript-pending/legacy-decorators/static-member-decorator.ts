/*---
description: A legacy decorator on a static member receives the constructor itself as its target.
features: [ts-legacy-decorators, ts-class, ts-static]
---*/
let target: unknown;
function capture(t: object, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  target = t;
  return descriptor;
}
class Factory {
  @capture
  static create(): Factory {
    return new Factory();
  }
}
assert.sameValue(target, Factory);
assert.sameValue(Factory.create() instanceof Factory, true);
