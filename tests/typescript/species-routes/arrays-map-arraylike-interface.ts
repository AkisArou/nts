/*---
description: "Array.prototype.map.call ignores a non-array receiver constructor through an ArrayLike interface."
features: [ts-species-routes, ts-species-route-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-class-fields, ts-symbols, ts-accessors, ts-functions, ts-iteration, ts-objects, ts-instanceof, ts-unknown, ts-interfaces]
---*/
// map.call crosses an ArrayLike interface; node skips its constructor entirely and allocates a sparse plain Array.
const log: unknown[] = [];
class Pretend extends Array<number> { mark = "pretend"; constructor(length: number) { super(length); log.push(Pretend, arguments.length, length, new.target); } static get [Symbol.species]() { log.push("species"); return Array; } }
interface Route extends ArrayLike<number> {}
function visit(value: number, index: number): number { log.push("visit", index, value); return value * 2; }
function run(input: Route): unknown[] { return Array.prototype.map.call(input, visit); }
const constructors: unknown[] = [Pretend, undefined, { [Symbol.species]: Pretend }, 3, null];
for (const constructor of constructors) {
  log.length = 0; const input: Route = { 0: -0, 2: 7, length: 3 };
  Object.defineProperty(input, "constructor", { get() { log.push("constructor", constructor); return constructor; }, configurable: true });
  const result = run(input); assert.compareArray(log, ["visit", 0, -0, "visit", 2, 7]);
  assert.compareArray([result instanceof Array, result instanceof Pretend, Array.isArray(result)], [true, false, true]);
  assert.sameValue(Object.getPrototypeOf(result), Array.prototype); assert.compareArray(result, [-0, undefined, 14]);
  assert.compareArray(Reflect.ownKeys(result), ["0", "2", "length"]); assert.sameValue(Object.hasOwn(result, "1"), false);
  const descriptor = Object.getOwnPropertyDescriptor(result, "0"); assert.compareArray([descriptor?.writable, descriptor?.enumerable, descriptor?.configurable], [true, true, true]);
  assert.sameValue(input.length, 3); assert.sameValue(input[0], -0); assert.sameValue(input[2], 7); assert.sameValue(Object.hasOwn(input, "1"), false);
}
