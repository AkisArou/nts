/*---
description: "Array.of constructs the typed constructor value for of. The control uses explicit construction and writes."
features: [ts-species-routes, ts-species-route-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-class-fields, ts-symbols, ts-accessors, ts-functions, ts-iteration, ts-objects, ts-instanceof, ts-unknown, ts-interfaces, ts-construct-signatures, ts-spread]
---*/
// Array.of crosses a declared constructor interface; node constructs this with the length and never reads species.
const log: unknown[] = [];
class Vec extends Array<number> {
  mark = "vec"; constructor(...values: number[]) { super(...values); log.push(Vec, values.length, ...values, new.target); }
  set 0(value: number) { log.push("inherited setter", value); }
  static get [Symbol.species]() { log.push("species", this); return Array; }
}
class Middle extends Vec { constructor(...values: number[]) { super(...values); log.push(Middle, values.length, ...values, new.target); } }
class Leaf extends Middle {}
class Sibling extends Vec {}
interface Factory { new (...values: number[]): number[]; of(...values: number[]): number[]; }
const input: number[] = [-0, 3.5, NaN];
function run(C: Factory): number[] {
  const value: unknown = Reflect.construct(C, [input.length]); if (!Array.isArray(value)) throw new TypeError(); const result: number[] = value;
  for (let i = 0; i < input.length; i++) Object.defineProperty(result, i, { value: input[i], writable: true, enumerable: true, configurable: true }); result.length = input.length;
  return result;
}
const choices: [Factory, object][] = [[Vec, Vec.prototype], [Middle, Middle.prototype], [Leaf, Leaf.prototype], [Sibling, Sibling.prototype], [Array, Array.prototype]];
for (const [C, prototype] of choices) {
  log.length = 0; const result = run(C);
  const history: unknown[] = C === Array ? [] : [Vec, 1, 3, C, ...(C === Middle || C === Leaf ? [Middle, 1, 3, C] : [])];
  assert.compareArray(log, history); assert.sameValue(Object.getPrototypeOf(result), prototype);
  assert.compareArray([result instanceof Array, result instanceof Vec, result instanceof Middle, result instanceof Leaf, result instanceof Sibling], [true, C !== Array, C === Middle || C === Leaf, C === Leaf, C === Sibling]);
  assert.sameValue(Array.isArray(result), true); if (result instanceof Vec) assert.sameValue(result.mark, "vec");
  assert.compareArray(result, [-0, 3.5, NaN]); assert.sameValue(Object.hasOwn(result, "1"), true);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "2", "length", ...(C === Array ? [] : ["mark"])]);
  const descriptor = Object.getOwnPropertyDescriptor(result, "0"); assert.compareArray([descriptor?.writable, descriptor?.enumerable, descriptor?.configurable], [true, true, true]);
}
