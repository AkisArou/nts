/*---
description: "Array with ignores species through a tuple route. The control uses explicit construction and writes."
features: [ts-species-routes, ts-species-route-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-class-fields, ts-symbols, ts-accessors, ts-functions, ts-iteration, ts-objects, ts-instanceof, ts-unknown, ts-tuples]
---*/
// with crosses the declared tuple route; node ignores constructor/species and returns a plain Array.
const log: unknown[] = [];
class Vec extends Array<number> {
  mark = "vec"; constructor(length: number) { super(length); log.push(Vec, arguments.length, length, new.target); }
  set 0(value: number) { log.push("inherited setter", value); }
  static get [Symbol.species]() { log.push("species", this); return super[Symbol.species]; }
}
class Middle extends Vec { constructor(length: number) { super(length); log.push(Middle, arguments.length, length, new.target); } }
class Leaf extends Middle {}
class Sibling extends Vec { static get [Symbol.species]() { log.push("sibling", this); return Array; } }
function put(target: number[], index: number, value: number): void { Object.defineProperty(target, index, { value, writable: true, enumerable: true, configurable: true }); }
function run(route: [number[], string]): number[] {
  const input = route[0];
  const result: number[] = new Array(4);
  for (let i = 0; i < input.length; i++) put(result, i, i === 1 ? 8 : input[i]);
  return result;
}
const choices: (new (length: number) => number[])[] = [Vec, Middle, Leaf, Sibling, Array];
for (const C of choices) {
  log.length = 0; const source: number[] = new C(4);
  Object.defineProperty(source, "0", { value: 3, writable: true, enumerable: true, configurable: true }); source[2] = 1; source[3] = -0;
  Object.defineProperty(source, "constructor", { get() { log.push("constructor"); throw new Error("unexpected constructor read"); }, configurable: true });
  const result = run([source, "chosen"]);
  assert.compareArray(log, C === Array ? [] : [Vec, 1, 4, C, ...(C === Middle || C === Leaf ? [Middle, 1, 4, C] : [])]);
  assert.sameValue(Object.getPrototypeOf(result), Array.prototype); assert.sameValue(Array.isArray(result), true);
  assert.compareArray([result instanceof Array, result instanceof Vec, result instanceof Middle, result instanceof Leaf, result instanceof Sibling], [true, false, false, false, false]);
  assert.compareArray(result, [3, 8, 1, -0]); assert.sameValue(Object.hasOwn(result, "1"), true);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "2", "3", "length"]);
  const descriptor = Object.getOwnPropertyDescriptor(result, "0"); assert.compareArray([descriptor?.writable, descriptor?.enumerable, descriptor?.configurable], [true, true, true]);
  assert.compareArray(source, [3, undefined, 1, -0]); assert.sameValue(Object.hasOwn(source, "1"), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "3", "length", ...(C === Array ? [] : ["mark"]), "constructor"]);
}
