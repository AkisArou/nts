/*---
description: A static `accessor` field is an accessor pair on the class itself.
features: [ts-accessor-fields, ts-class, ts-static]
---*/
class Config {
  static accessor mode = "dev";
}
assert.sameValue(Config.mode, "dev");
Config.mode = "prod";
assert.sameValue(Config.mode, "prod");
assert.sameValue(typeof Object.getOwnPropertyDescriptor(Config, "mode")?.get, "function");
