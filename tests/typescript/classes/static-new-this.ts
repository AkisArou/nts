/*---
description: `new this()` in a static method constructs the class the method was called on.
features: [ts-class, ts-static, ts-inheritance]
---*/
class Model {
  kind(): string {
    return "model";
  }
  static create(): Model {
    return new this();
  }
}
class User extends Model {
  override kind(): string {
    return "user";
  }
}
assert.sameValue(Model.create().kind(), "model");
assert.sameValue(User.create().kind(), "user");
assert.sameValue(User.create() instanceof User, true);
