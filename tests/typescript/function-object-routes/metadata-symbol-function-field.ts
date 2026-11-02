/*---
description: Symbol-key inferred function names survive storage in a typed function field.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-interfaces, ts-symbols, ts-computed-keys, ts-default-parameters, ts-arrow-functions, ts-record, ts-unions, ts-null-undefined]
---*/
// A Slot field carries symbol-key arrows, methods and expressions; node names them from the description in brackets, or empty when absent.
type Numeric = (a: number, b: number, c: number) => number;
interface Slot { fn: Numeric; }
function make(description: string | undefined, form: number): Slot {
  const key = Symbol(description);
  if (form === 0) { const source: Record<symbol, Numeric> = { [key]: (): number => 0 }; return { fn: source[key] }; }
  if (form === 1) { const source: Record<symbol, Numeric> = { [key](a: number, b = 2): number { return a + b; } }; return { fn: source[key] }; }
  const source: Record<symbol, Numeric> = { [key]: function (a: number, b: number, c: number): number { return a + b + c; } }; return { fn: source[key] };
}
function observe(slot: Slot): [string, number] { const target = slot.fn; return [target.name, target.length]; }
const descriptions: (string | undefined)[] = [undefined, "", "run", "a]b", "\u00e9\u4e2d"];
const forms: [number, number][] = [[0, 0], [1, 1], [2, 3]];
for (const description of descriptions) for (const [form, arity] of forms) {
  const label = description === undefined ? "" : "[" + description + "]";
  const actual = observe(make(description, form));
  assert.sameValue(actual[0], label); assert.sameValue(actual[1], arity);
  assert.compareArray(actual, [label, arity]);
}
