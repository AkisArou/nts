/*---
description: String-ID record control for A tuple-selected symbol deletion and reinsertion moves only that identity to the end of the symbol group.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-type-aliases, ts-tuples, ts-optional-properties, ts-null-undefined]
---*/
// A tuple carries an optional-key target and selected symbol; node reinserts symbols after surviving symbols and strings after surviving strings, leaving integer keys first.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second";
interface Target { fields: Record<string, number>; text: Record<string, number>; order: string[]; }
type Route = [Target, typeof first | typeof second];
function makeTarget(input: number, populated: boolean): Target { return populated ? { fields: { [first]: input, [second]: input }, text: { alpha: 11, "2": 2, beta: 13 }, order: [first, second] } : { fields: {}, text: {}, order: [] }; }
function change(entry: Route): boolean { const target = entry[0], key = entry[1], at = target.order.indexOf(key); if (at >= 0) target.order.splice(at, 1); const removed = delete target.fields[key]; delete target.text.alpha; delete target.text["2"]; target.order.push(key); target.fields[key] = 17; target.text.alpha = 23; target.text["2"] = 2; return removed; }
function keys(target: Target): string[] { return Object.keys(target.text); }
function tokens(target: Target): string[] { return target.order.slice(); }
function all(target: Target): string[] { return keys(target).concat(tokens(target)); }
function read(target: Target, key: typeof first | typeof second): number | undefined { return target.fields[key]; }
function text(target: Target, key: "2" | "alpha" | "beta"): number | undefined { return target.text[key]; }
const choices: (typeof first | typeof second)[] = [first, second];
for (const input of [-0, NaN, 31]) for (const populated of [false, true]) for (const key of choices) {
  const target = makeTarget(input, populated), entry: Route = [target, key], other = key === first ? second : first;
  assert.compareArray(keys(target), populated ? ["2", "alpha", "beta"] : []); assert.compareArray(tokens(target), populated ? [first, second] : []);
  same(change(entry), true); same(read(target, key), 17); same(read(target, other), populated ? input : undefined); same(Object.is(key, other), false);
  same(text(target, "2"), 2); same(text(target, "alpha"), 23); same(text(target, "beta"), populated ? 13 : undefined);
  assert.compareArray(keys(target), populated ? ["2", "beta", "alpha"] : ["2", "alpha"]); assert.compareArray(tokens(target), populated ? [other, key] : [key]);
  assert.compareArray(all(target), populated ? ["2", "beta", "alpha", other, key] : ["2", "alpha", key]);
}
