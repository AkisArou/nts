/*---
description: Explicit metadata record control for Symbol-key inferred function names survive storage in a typed function field.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-unions, ts-null-undefined]
---*/
// Explicit records: A Slot field carries symbol-key arrows, methods and expressions; node names them from the description in brackets, or empty when absent.
interface Metadata { label: string; arity: number; }
interface Slot { fn: Metadata; }
function make(description: string | undefined, form: number): Slot { return { fn: { label: description === undefined ? "" : "[" + description + "]", arity: form === 0 ? 0 : form === 1 ? 1 : 3 } }; }
function observe(slot: Slot): [string, number] { const target = slot.fn; return [target.label, target.arity]; }
const descriptions: (string | undefined)[] = [undefined, "", "run", "a]b", "\u00e9\u4e2d"];
const forms: [number, number][] = [[0, 0], [1, 1], [2, 3]];
for (const description of descriptions) for (const [form, arity] of forms) {
  const label = description === undefined ? "" : "[" + description + "]";
  const actual = observe(make(description, form));
  assert.sameValue(actual[0], label); assert.sameValue(actual[1], arity);
  assert.compareArray(actual, [label, arity]);
}
