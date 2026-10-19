/*---
description: A function taking a class and returning a subclass of it adds members to any base.
features: [ts-class, ts-mixins, ts-generics, ts-class-expression]
---*/
type Constructor<T = object> = new (...args: any[]) => T;
function Tagged<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    tag = "tagged";
  };
}
class Plain {
  constructor(public id: number) {}
}
const TaggedPlain = Tagged(Plain);
const value = new TaggedPlain(7);
assert.sameValue(value.id, 7);
assert.sameValue(value.tag, "tagged");
assert.sameValue(value instanceof Plain, true);
