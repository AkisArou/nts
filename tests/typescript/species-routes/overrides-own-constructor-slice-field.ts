/*---
description: Own constructor choices govern slice through a number-array interface field.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-accessors, ts-static, ts-computed-keys, ts-interfaces, ts-tuples, ts-iteration, ts-arrow-functions, ts-null-undefined, ts-bigint]
---*/
// slice follows an interface field and an own constructor getter; node selects species, defaults undefined, and rejects primitive constructors before reading elements.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Other extends Array<number> {
  constructor(length: number) { super(length); log.push("other", new.target, arguments.length, length); }
  static get [Symbol.species](): ArrayConstructor { log.push("class-species", this); return super[Symbol.species]; }
}
class Further extends Other {}
const speciesObject = { get [Symbol.species]() { log.push("object-species", this); return Further; } };
const constructorArrow = () => { log.push("constructor-arrow-called"); return []; };
interface Holder { values: number[]; }
function run(holder: Holder): unknown { return holder.values.slice(0, 3); }
const choices: [unknown, number][] = [[Other, 1], [constructorArrow, 0], [undefined, 0], [speciesObject, 2], [{}, 0], [null, -1], [0, -1], [-0, -1], [NaN, -1], [false, -1], ["x", -1], [1n, -1], [Symbol("x"), -1]];
for (const [choice, kind] of choices) {
  log.length = 0; const source = new Child(3); source[0] = -0; source[2] = NaN;
  assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
  Object.defineProperty(source, "constructor", { get() { log.push("constructor", this); return choice; }, configurable: true });
  const holder: Holder = { values: source };
  if (kind < 0) assert.throws(TypeError, () => run(holder));
  else {
    const result: unknown = run(holder); if (!Array.isArray(result)) throw new TypeError();
    same(Object.getPrototypeOf(result), kind === 1 ? Other.prototype : kind === 2 ? Further.prototype : Array.prototype); same(Array.isArray(result), true); same(result === source, false);
    same(result instanceof Source, false); same(result instanceof Child, false); same(result instanceof Other, kind > 0); same(result instanceof Further, kind === 2); same(result instanceof Array, true);
    same(result.length, 3); same(result[0], -0); same(result[2], NaN); same(Object.hasOwn(result, 1), false);
    assert.compareArray(Reflect.ownKeys(result), ["0", "2", "length"]);
  }
  const expected: unknown[] = ["constructor", source];
  if (kind === 1) expected.push("class-species", Other, "other", Other, 1, 3);
  if (kind === 2) expected.push("object-species", speciesObject, "other", Further, 1, 3);
  assert.compareArray(log, expected);
  same(source.length, 3); same(source[0], -0); same(source[2], NaN); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "length", "constructor"]);
}
