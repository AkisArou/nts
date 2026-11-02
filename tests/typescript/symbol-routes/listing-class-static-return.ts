/*---
description: Static class symbols retain method-before-field insertion order across a declared return type.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-static, ts-optional-properties, ts-null-undefined, ts-arrow-functions, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A StaticShape return carries empty and populated constructors; node lists hidden constructor strings before static data and keeps computed method then field symbol order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const field: unique symbol = Symbol("member"), method: unique symbol = Symbol("member");
interface StaticShape { readonly name: string; prototype: object; label?: string; [field]?: number; [method]?(): number; }
function makeTarget(input: number, populated: boolean): StaticShape { class Empty {} class Catalog { static [field]: number = input; static [method](): number { return input; } static label: string = "catalog"; } return populated ? Catalog : Empty; }
function keys(target: StaticShape): string[] { return Object.keys(target); }
function names(target: StaticShape): string[] { return Object.getOwnPropertyNames(target); }
function tokens(target: StaticShape): symbol[] { return Object.getOwnPropertySymbols(target); }
function all(target: StaticShape): PropertyKey[] { return Reflect.ownKeys(target); }
function values(target: StaticShape): unknown[] { return Object.values(target); }
function read(target: StaticShape): number | undefined { return target[field]; }
function invoke(target: StaticShape): number | undefined { const operation = target[method]; return operation === undefined ? undefined : operation(); }
for (const input of [-0, NaN, 17]) for (const populated of [false, true]) {
  const target = makeTarget(input, populated);
  assert.compareArray(keys(target), populated ? ["label"] : []); assert.compareArray(values(target), populated ? ["catalog"] : []);
  assert.compareArray(names(target), populated ? ["length", "name", "prototype", "label"] : ["length", "name", "prototype"]);
  assert.compareArray(tokens(target), populated ? [method, field] : []); assert.compareArray(all(target), populated ? ["length", "name", "prototype", "label", method, field] : ["length", "name", "prototype"]);
  same(read(target), populated ? input : undefined); same(invoke(target), populated ? input : undefined); same(Object.is(field, method), false);
}
