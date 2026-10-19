/*---
description: A class's Symbol.toStringTag getter names it in Object.prototype.toString.
features: [ts-symbols, ts-class, ts-accessors]
---*/
class Vault {
  get [Symbol.toStringTag](): string {
    return "Vault";
  }
}
class Plain {}
assert.sameValue(Object.prototype.toString.call(new Vault()), "[object Vault]");
assert.sameValue(Object.prototype.toString.call(new Plain()), "[object Object]");
assert.sameValue(String(new Vault()), "[object Vault]");
