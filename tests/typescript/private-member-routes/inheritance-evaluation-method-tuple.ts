/*---
description: A private method value is shared within one class evaluation and different across evaluations, with its receiver checked by the body.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-class-expression, ts-functions, ts-tuples, ts-unknown, ts-this, ts-this-parameter, ts-static, ts-private-fields]
---*/
// EvaluatedReader instances occupy a typed tuple; node returns one private function per evaluation and rejects a body receiver with the other evaluation brand.
function createReader() {
  return class EvaluatedReader {
    #value: unknown;
    constructor(value: unknown) { this.#value = value; }
    #read(): unknown { return this.#value; }
    method(): (this: object) => unknown { return this.#read; }
    static owns(value: object): boolean { return #read in value; }
  };
}
for (const value of [undefined, -0, "", { value: 1 }]) {
  const First = createReader(), Second = createReader(), next = { value };
  const sources: [InstanceType<typeof First>, InstanceType<typeof First>, InstanceType<typeof Second>] = [new First(value), new First(next), new Second(value)];
  const original = sources[0].method(), sibling = sources[1].method(), other = sources[2].method();
  assert.sameValue(original, sibling); assert.notSameValue(original, other);
  assert.sameValue(original.call(sources[0]), value); assert.sameValue(original.call(sources[1]), next);
  assert.sameValue(other.call(sources[2]), value);
  assert.throws(TypeError, () => original.call(sources[2])); assert.throws(TypeError, () => other.call(sources[0]));
  assert.throws(TypeError, () => original.call({})); assert.throws(TypeError, () => other.call({}));
  for (let index = 0; index < sources.length; index++) {
    assert.sameValue(First.owns(sources[index]), index < 2); assert.sameValue(Second.owns(sources[index]), index === 2);
  }
}
