/*---
description: "Array concat chooses the receiver species through a tuple-element."
features: [ts-species-routes, ts-species-route-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-class-fields, ts-symbols, ts-accessors, ts-functions, ts-iteration, ts-objects, ts-instanceof, ts-unknown, ts-tuples]
---*/
// concat crosses a tuple-element; node constructs the runtime species with [0], defines elements and preserves the listed holes.
const log: unknown[] = [];
type Item = number;
class Vec extends Array<Item> {
  mark = "vec"; constructor(length: number) { super(length); log.push(Vec, arguments.length, length, new.target); }
  set 0(value: Item) { log.push("inherited setter", value); }
  static get [Symbol.species]() { log.push("species", this); return super[Symbol.species]; }
}
class Middle extends Vec { constructor(length: number) { super(length); log.push(Middle, arguments.length, length, new.target); } }
class Leaf extends Middle {}
class Sibling extends Vec { static get [Symbol.species]() { log.push("sibling", this); return super[Symbol.species]; } }
function calls(C: new (length: number) => Item[], length: number): unknown[] {
  return C === Array ? [] : [Vec, 1, length, C, ...(C === Middle || C === Leaf ? [Middle, 1, length, C] : [])];
}
const first = -0;
function fill(value: Item[]): void { Object.defineProperty(value, "0", { value: first, writable: true, enumerable: true, configurable: true }); value[2] = 3.5; value[3] = NaN; }
function run(route: [string, Item[]]): number[] {
  return route[1].concat([8]);
}
const choices: [new (length: number) => Item[], object][] = [[Vec, Vec.prototype], [Middle, Middle.prototype], [Leaf, Leaf.prototype], [Sibling, Sibling.prototype], [Array, Array.prototype]];
for (const [C, prototype] of choices) {
  log.length = 0;
  const source: Item[] = new C(4); fill(source);
  const result = run(["chosen", source]);
  const history = [...calls(C, 4), ...(C === Array ? [] : [...(C === Sibling ? ["sibling", C] : []), "species", C]), ...calls(C, 0)];
  assert.compareArray(log, history); assert.sameValue(Object.getPrototypeOf(result), prototype);
  assert.compareArray([result instanceof Array, result instanceof Vec, result instanceof Middle, result instanceof Leaf, result instanceof Sibling], [true, C !== Array, C === Middle || C === Leaf, C === Leaf, C === Sibling]);
  assert.sameValue(Array.isArray(result), true); if (result instanceof Vec) assert.sameValue(result.mark, "vec");
  assert.compareArray(result, [-0, undefined, 3.5, NaN, 8]); assert.sameValue(Object.hasOwn(result, "1"), false);
  assert.compareArray(Reflect.ownKeys(result), [...["0", "2", "3", "4"], "length", ...(C === Array ? [] : ["mark"])]);
  const descriptor = Object.getOwnPropertyDescriptor(result, "0"); assert.compareArray([descriptor?.writable, descriptor?.enumerable, descriptor?.configurable], [true, true, true]);
  assert.compareArray(source, [first, undefined, 3.5, NaN]); assert.sameValue(Object.hasOwn(source, "1"), false);
}
