/*---
description: A private brand is absent before its field initialization and present after construction through a class parameter.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-inheritance, ts-private-fields]
---*/
// OrderedOwner instances cross an inspect parameter; node reports false for the captured early brand and true for the completed instance.
class OrderedOwner {
  #before: boolean = this.hasLater(); #later: unknown;
  constructor(value: unknown) { this.#later = value; }
  hasLater(): boolean { return #later in this; }
  before(): boolean { return this.#before; }
  read(): unknown { return this.#later; }
}
class Child extends OrderedOwner {}
function inspect(owner: OrderedOwner, expected: unknown): void {
  assert.sameValue(owner.before(), false); assert.sameValue(owner.hasLater(), true); assert.sameValue(owner.read(), expected);
}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const entries: OrderedOwner[] = [new Child(value), new OrderedOwner(value), new Child(value)];
  for (const entry of entries) inspect(entry, value);
}
