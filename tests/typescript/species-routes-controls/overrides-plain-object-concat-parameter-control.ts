/*---
description: A plain-object species destination exposes concat property definition order and length effects. The control explicitly constructs and defines the result.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-accessors, ts-iteration, ts-tuples, ts-this-parameter, ts-optional-chaining, ts-null-undefined]
---*/
// concat crosses a base-array parameter; node defines indices past an inherited setter and sets length after all elements. The control follows constructor lookup and explicit writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function create(view: unknown[], length: number): object {
  let ctor: unknown = Reflect.get(view, "constructor");
  if ((typeof ctor === "object" && ctor !== null) || typeof ctor === "function") { ctor = Reflect.get(ctor, Symbol.species); if (ctor === null) ctor = undefined; }
  if (ctor === undefined) ctor = Array;
  if (typeof ctor !== "function") throw new TypeError();
  const result: unknown = Reflect.construct(ctor, [length]);
  if ((typeof result !== "object" || result === null) && typeof result !== "function") throw new TypeError();
  return result;
}
function put(target: object, index: number, value: unknown): void { Object.defineProperty(target, index, { value, writable: true, enumerable: true, configurable: true }); }
const log: unknown[] = []; let destination: object = {};
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
function run(view: number[]): unknown {
  const length = view.length, output = create(view, 0);
  let targetIndex = 0;
  for (const input of [view, [9]]) for (let i = 0; i < input.length; i++, targetIndex++) if (i in input) put(output, targetIndex, input[i]);
  if (!Reflect.set(output, "length", targetIndex)) throw new TypeError();
  return output;
}
for (const accessor of [false, true]) {
  log.length = 0; let storedLength = 77;
  const prototype = { set 0(value: unknown) { log.push("index-set", this, value); } }; destination = Object.create(prototype);
  if (accessor) Object.defineProperty(destination, "length", { get() { log.push("length-get", this, storedLength); return storedLength; }, set(value: unknown) { log.push("length-set", this, value, Object.keys(this).join(",")); if (typeof value !== "number") throw new TypeError(); storedLength = value; }, configurable: true });
  const source = new Child(3), first: number = -0, last: number = NaN;
  assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
  function readFirst(this: object): number { log.push("get", this, 0, Object.keys(destination).join(",")); return first; }
  function readLast(this: object): number { log.push("get", this, 2, Object.keys(destination).join(",")); return last; }
  Object.defineProperty(source, 0, { get: readFirst, enumerable: true, configurable: true }); Object.defineProperty(source, 2, { get: readLast, enumerable: true, configurable: true });
  const result: unknown = run(source); if (typeof result !== "object" || result === null) throw new TypeError();
  same(result, destination); same(Object.getPrototypeOf(result), prototype); same(Array.isArray(result), false); same(result === source, false);
  same(result instanceof Source, false); same(result instanceof Child, false); same(result instanceof Returner, false); same(result instanceof Array, false);
  const expected: [number, number][] = [[0, -0], [2, NaN], [3, 9]];
  for (const [index, value] of expected) { same(Reflect.get(result, index), value); const descriptor = Object.getOwnPropertyDescriptor(result, index); if (descriptor === undefined) throw new TypeError(); same(descriptor.writable, true); same(descriptor.enumerable, true); same(descriptor.configurable, true); }
  same(Reflect.get(result, "length"), 4); same(Object.hasOwn(result, "length"), true);
  const keys: string[] = ["0", "2", "3"]; keys.push("length"); assert.compareArray(Reflect.ownKeys(result), keys);
  same(Object.hasOwn(result, 1), false);
  const expectedLog: unknown[] = ["species", Child, "construct", Returner, 1, 0, "get", source, 0, "", "get", source, 2, "0"];
  if (accessor) expectedLog.push("length-set", destination, 4, "0,2,3");
  if (accessor) expectedLog.push("length-get", destination, 4);
  assert.compareArray(log, expectedLog);
  same(source.length, 3); same(Object.hasOwn(source, 1), false); assert.compareArray(Reflect.ownKeys(source), ["0", "2", "length"]);
  same(Object.getOwnPropertyDescriptor(source, 0)?.get, readFirst); same(Object.getOwnPropertyDescriptor(source, 2)?.get, readLast);
}
