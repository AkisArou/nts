/*---
description: A field with a definite assignment assertion is defined as undefined until a method assigns it.
features: [ts-class, ts-class-fields, ts-definite-assignment]
---*/
class Connection {
  id!: number;
  open(id: number): this {
    this.id = id;
    return this;
  }
}
const connection = new Connection();
assert.sameValue(connection.id, undefined);
assert.sameValue(Object.keys(connection).join(","), "id");
assert.sameValue(connection.open(4).id, 4);
