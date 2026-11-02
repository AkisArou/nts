/*---
description: A returned constructor retains static block initialization and its private brand.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-class-fields, ts-class-static-block, ts-interfaces, ts-inheritance, ts-unknown, ts-tuples, ts-objects, ts-private-fields]
---*/
// BlockOwner leaves a factory through a declared constructor interface; node records both private values in static-block order and inherited reads throw.
interface StaticPort { new (): object; read(): unknown; }
const log: unknown[] = [];
function create(seed: unknown, next: unknown): StaticPort {
  class BlockOwner {
    static #value: unknown = seed;
    static { log.push(this.#value); this.#value = next; log.push(this.#value); }
    static read(): unknown { return this.#value; }
  }
  return BlockOwner;
}
const values: unknown[] = [-0, NaN, undefined, "", { id: 1 }];
for (let index = 0; index < values.length; index++) {
  const seed = values[index], next = values[(index + 1) % values.length]; log.length = 0;
  const Owner: StaticPort = create(seed, next);
  class Child extends Owner {}
  assert.compareArray(log, [seed, next]);
  const constructors: [StaticPort, boolean][] = [[Child, false], [Owner, true], [Child, false], [Owner, true]];
  for (const [receiver, valid] of constructors) {
    if (valid) assert.sameValue(receiver.read(), next);
    else assert.throws(TypeError, () => receiver.read());
    assert.sameValue(Owner.read(), next); assert.compareArray(log, [seed, next]);
  }
}
