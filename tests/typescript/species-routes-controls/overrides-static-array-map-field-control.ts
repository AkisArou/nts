/*---
description: An Array-returning static species getter makes map allocate a plain array through an interface field. The control explicitly constructs and defines the result.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-accessors, ts-static, ts-computed-keys, ts-interfaces, ts-iteration, ts-null-undefined]
---*/
// map crosses an interface number[] field; node reads the static getter once and returns Array with the same holes and exact values. The control follows constructor lookup and explicit writes.
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
const log: unknown[] = [];
class Source extends Array<number> {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): ArrayConstructor { log.push("species", this); return Array; }
}
class Further extends Source {}
class Sibling extends Array<number> {}
interface Holder { values: number[]; }
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view); return value; }
function run(holder: Holder): unknown {
  const view = holder.values, length = view.length, output = create(view, length);
  for (let i = 0; i < length; i++) if (i in view) put(output, i, visit(view[i], i, view));
  return output;
}
for (const Ctor of [Source, Further]) {
  log.length = 0; const source = new Ctor(4); source[0] = -0; source[2] = NaN; source[3] = 7;
  assert.compareArray(log, ["source", Ctor, 1, 4]); log.length = 0;
  const holder: Holder = { values: source }, result: unknown = run(holder);
  if (!Array.isArray(result)) throw new TypeError();
  same(Object.getPrototypeOf(result), Array.prototype); same(Array.isArray(result), true); same(result === source, false);
  same(result instanceof Source, false); same(result instanceof Further, false); same(result instanceof Sibling, false); same(result instanceof Array, true);
  same(result.length, 4); same(result[0], -0); same(result[2], NaN); same(result[3], 7); same(Object.hasOwn(result, 1), false);
  assert.compareArray(Reflect.ownKeys(result), ["0", "2", "3", "length"]);
  assert.compareArray(log, ["species", Ctor, "map", -0, 0, source, "map", NaN, 2, source, "map", 7, 3, source]);
  same(source.length, 4); same(source[0], -0); same(source[2], NaN); same(source[3], 7); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "3", "length"]);
}
