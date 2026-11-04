/*---
description: A string-declared subclass constructor stores the numeric species length through map. The control explicitly constructs and defines the result.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-accessors, ts-static, ts-computed-keys, ts-class-fields, ts-strings, ts-iteration, ts-null-undefined]
---*/
// map crosses a number[] parameter; node calls the string-labelled constructor with one number and preserves its actual stored type. The control follows constructor lookup and explicit writes.
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
class Labelled extends Array<number> {
  label: string;
  constructor(label: string) { super(); this.label = label; log.push("construct", new.target, arguments.length, label, typeof label); }
  static get [Symbol.species](): ArrayConstructor { log.push("species", this); return super[Symbol.species]; }
}
class Further extends Labelled {}
class Sibling extends Array<number> {}
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view); return value; }
function run(view: number[]): unknown {
  const length = view.length, output = create(view, length);
  for (let i = 0; i < length; i++) if (i in view) put(output, i, visit(view[i], i, view));
  return output;
}
for (const Ctor of [Labelled, Further]) for (const count of [0, 3]) {
  log.length = 0; const source = new Ctor("seed"); source.length = count; if (count > 0) { source[0] = -0; source[2] = NaN; }
  assert.compareArray(log, ["construct", Ctor, 1, "seed", "string"]); log.length = 0;
  const result: unknown = run(source); if (!(result instanceof Labelled)) throw new TypeError();
  same(result.label, count); same(Object.getPrototypeOf(result), Ctor.prototype); same(Array.isArray(result), true); same(result === source, false);
  same(result instanceof Labelled, true); same(result instanceof Further, Ctor === Further); same(result instanceof Sibling, false); same(result instanceof Array, true);
  same(result.length, count); same(result[0], count > 0 ? -0 : undefined); same(result[2], count > 0 ? NaN : undefined); same(Object.hasOwn(result, 1), false);
  assert.compareArray(Reflect.ownKeys(result), count > 0 ? ["0", "2", "length", "label"] : ["length", "label"]);
  const expected: unknown[] = ["species", Ctor, "construct", Ctor, 1, count, "number"];
  if (count > 0) expected.push("map", -0, 0, source, "map", NaN, 2, source); assert.compareArray(log, expected);
  same(source.label, "seed"); same(source.length, count); same(source[0], count > 0 ? -0 : undefined); same(source[2], count > 0 ? NaN : undefined); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), count > 0 ? ["0", "2", "length", "label"] : ["length", "label"]);
}
