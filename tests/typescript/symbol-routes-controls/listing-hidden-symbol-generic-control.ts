/*---
description: String-ID record control for A generic reader includes non-enumerable symbols in own-symbol and Reflect lists but never string listings.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-generics, ts-optional-properties, ts-null-undefined, ts-arrow-functions]
---*/
// A Hidden constraint carries default-hidden and enumerable same-description symbol fields; node retains both identities regardless of enumerability.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second";
interface Cell { value: number | undefined; enumerable: boolean; }
interface Hidden { text: Record<string, Cell>; fields: Record<string, Cell>; order: string[]; }
function makeTarget(input: number, mode: string): Hidden { return mode === "empty" ? { text: {}, fields: {}, order: [] } : { text: { tail: { value: 11, enumerable: true }, "1": { value: input, enumerable: true } }, fields: { [first]: { value: input, enumerable: mode === "shown" }, [second]: { value: undefined, enumerable: false } }, order: [first, second] }; }
function inspect<T extends Hidden>(target: T) { const names = Object.keys(target.text), strings = names.filter(key => target.text[key].enumerable), tokens = target.order.slice(); return { strings, names, tokens, all: names.concat(tokens) }; }
function read(target: Hidden, key: typeof first | typeof second): number | undefined { return target.order.includes(key) ? target.fields[key].value : undefined; }
function enumerable(target: Hidden, key: string): boolean | undefined { return target.order.includes(key) ? target.fields[key].enumerable : undefined; }
for (const input of [-0, NaN, 17]) for (const mode of ["empty", "hidden", "shown"]) {
  const target = makeTarget(input, mode), result = inspect(target);
  assert.compareArray(result.strings, mode === "empty" ? [] : ["1", "tail"]); assert.compareArray(result.names, mode === "empty" ? [] : ["1", "tail"]);
  assert.compareArray(result.tokens, mode === "empty" ? [] : [first, second]); assert.compareArray(result.all, mode === "empty" ? [] : ["1", "tail", first, second]);
  same(read(target, first), mode === "empty" ? undefined : input); same(read(target, second), undefined); same(Object.is(first, second), false);
  same(enumerable(target, first), mode === "empty" ? undefined : mode === "shown"); same(enumerable(target, second), mode === "empty" ? undefined : false);
}
