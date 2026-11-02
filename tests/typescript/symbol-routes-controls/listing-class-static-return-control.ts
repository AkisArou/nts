/*---
description: String-ID record control for Static class symbols retain method-before-field insertion order across a declared return type.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-static, ts-optional-properties, ts-null-undefined, ts-arrow-functions]
---*/
// A StaticShape return carries empty and populated constructors; node lists hidden constructor strings before static data and keeps computed method then field symbol order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const field = "token:field", method = "token:method";
interface StaticShape { strings: { key: string; value: unknown; enumerable: boolean }[]; fields: Record<string, number | (() => number)>; order: string[]; }
function makeTarget(input: number, populated: boolean): StaticShape { const target: StaticShape = { strings: [{ key: "length", value: 0, enumerable: false }, { key: "name", value: populated ? "Catalog" : "Empty", enumerable: false }, { key: "prototype", value: {}, enumerable: false }], fields: {}, order: [] }; if (populated) { target.strings.push({ key: "label", value: "catalog", enumerable: true }); target.fields[method] = () => input; target.order.push(method); target.fields[field] = input; target.order.push(field); } return target; }
function keys(target: StaticShape): string[] { return target.strings.filter(cell => cell.enumerable).map(cell => cell.key); }
function names(target: StaticShape): string[] { return target.strings.map(cell => cell.key); }
function tokens(target: StaticShape): string[] { return target.order.slice(); }
function all(target: StaticShape): string[] { return names(target).concat(tokens(target)); }
function values(target: StaticShape): unknown[] { return target.strings.filter(cell => cell.enumerable).map(cell => cell.value); }
function read(target: StaticShape): number | undefined { const value = target.fields[field]; return typeof value === "number" ? value : undefined; }
function invoke(target: StaticShape): number | undefined { const operation = target.fields[method]; return typeof operation === "function" ? operation() : undefined; }
for (const input of [-0, NaN, 17]) for (const populated of [false, true]) {
  const target = makeTarget(input, populated);
  assert.compareArray(keys(target), populated ? ["label"] : []); assert.compareArray(values(target), populated ? ["catalog"] : []);
  assert.compareArray(names(target), populated ? ["length", "name", "prototype", "label"] : ["length", "name", "prototype"]);
  assert.compareArray(tokens(target), populated ? [method, field] : []); assert.compareArray(all(target), populated ? ["length", "name", "prototype", "label", method, field] : ["length", "name", "prototype"]);
  same(read(target), populated ? input : undefined); same(invoke(target), populated ? input : undefined); same(Object.is(field, method), false);
}
