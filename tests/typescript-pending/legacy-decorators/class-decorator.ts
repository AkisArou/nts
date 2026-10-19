/*---
description: A legacy class decorator receives the constructor and may return a replacement, which the binding then holds.
features: [ts-legacy-decorators, ts-class]
---*/
const registered: string[] = [];
function register<T extends new (...args: any[]) => object>(ctor: T): T {
  registered.push(ctor.name);
  return class extends ctor {
    registered = true;
  };
}
@register
class Service {
  constructor(public label: string) {}
}
const service = new Service("s") as Service & { registered: boolean };
assert.compareArray(registered, ["Service"]);
assert.sameValue(service.registered, true);
assert.sameValue(service.label, "s");
