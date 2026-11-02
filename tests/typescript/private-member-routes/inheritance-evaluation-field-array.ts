/*---
description: Two evaluations of one class expression create independent private names despite sharing one TypeScript instance type.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-class-expression, ts-functions, ts-unknown, ts-static, ts-type-aliases, ts-utility-types, ts-typeof-type, ts-private-fields]
---*/
// EvaluatedVault instances share a declared array element type across factory calls; node keeps each evaluation brand and throws on the other evaluation private read or write.
function createVault() {
  return class EvaluatedVault {
    label: string = "same"; #value: unknown;
    constructor(value: unknown) { this.#value = value; }
    static owns(value: object): boolean { return #value in value; }
    static read(value: EvaluatedVault): unknown { return value.#value; }
    static write(value: EvaluatedVault, next: unknown): unknown { return value.#value = next; }
  };
}
type Evaluated = InstanceType<ReturnType<typeof createVault>>;
for (const value of [-0, 3, 17]) {
  const First = createVault(), Second = createVault();
  const second = new Second(value + 1), first = new First(value);
  const sources: Evaluated[] = [first, second, new First(value + 2), new Second(value + 3)], constructors = [First, Second];
  const expected = [value, value + 1, value + 2, value + 3], next = { value };
  for (let owner = 0; owner < constructors.length; owner++) for (let index = 0; index < sources.length; index++) {
    const source: Evaluated = sources[index], ctor = constructors[owner];
    assert.sameValue(ctor.owns(source), index % 2 === owner);
    if (index % 2 === owner) {
      assert.sameValue(ctor.read(source), expected[index]); assert.sameValue(ctor.write(source, next), next);
      assert.sameValue(ctor.read(source), next); assert.sameValue(ctor.write(source, expected[index]), expected[index]);
      assert.sameValue(ctor.read(source), expected[index]);
    } else { assert.throws(TypeError, () => ctor.read(source)); assert.throws(TypeError, () => ctor.write(source, next)); }
  }
  assert.sameValue(First.owns({ label: "same" }), false); assert.sameValue(Second.owns({ label: "same" }), false);
}
