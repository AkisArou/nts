/*---
description: A private `accessor #field` is read and written inside the class only, and is not a property.
features: [ts-accessor-fields, ts-class, ts-private-fields]
---*/
class Secret {
  accessor #code = 1234;
  rotate(): number {
    this.#code = (this.#code * 7) % 10000;
    return this.#code;
  }
}
const secret = new Secret();
assert.sameValue(secret.rotate(), 8638);
assert.sameValue(Object.getOwnPropertyNames(Secret.prototype).join(","), "constructor,rotate");
