/*---
description: A tuple-selected symbol deletion and reinsertion moves only that identity to the end of the symbol group.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-type-aliases, ts-tuples, ts-optional-properties, ts-null-undefined, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A tuple carries an optional-key target and selected symbol; node reinserts symbols after surviving symbols and strings after surviving strings, leaving integer keys first.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same");
interface Target { [first]?: number; [second]?: number; "2"?: number; alpha?: number; beta?: number; }
type Route = [Target, typeof first | typeof second];
function makeTarget(input: number, populated: boolean): Target { return populated ? { [first]: input, alpha: 11, [second]: input, "2": 2, beta: 13 } : {}; }
function change(entry: Route): boolean { const target = entry[0], key = entry[1], removed = delete target[key]; delete target.alpha; delete target["2"]; target[key] = 17; target.alpha = 23; target["2"] = 2; return removed; }
function keys(target: Target): string[] { return Object.keys(target); }
function tokens(target: Target): symbol[] { return Object.getOwnPropertySymbols(target); }
function all(target: Target): PropertyKey[] { return Reflect.ownKeys(target); }
function read(target: Target, key: typeof first | typeof second): number | undefined { return target[key]; }
function text(target: Target, key: "2" | "alpha" | "beta"): number | undefined { return target[key]; }
const choices: (typeof first | typeof second)[] = [first, second];
for (const input of [-0, NaN, 31]) for (const populated of [false, true]) for (const key of choices) {
  const target = makeTarget(input, populated), entry: Route = [target, key], other = key === first ? second : first;
  assert.compareArray(keys(target), populated ? ["2", "alpha", "beta"] : []); assert.compareArray(tokens(target), populated ? [first, second] : []);
  same(change(entry), true); same(read(target, key), 17); same(read(target, other), populated ? input : undefined); same(Object.is(key, other), false);
  same(text(target, "2"), 2); same(text(target, "alpha"), 23); same(text(target, "beta"), populated ? 13 : undefined);
  assert.compareArray(keys(target), populated ? ["2", "beta", "alpha"] : ["2", "alpha"]); assert.compareArray(tokens(target), populated ? [other, key] : [key]);
  assert.compareArray(all(target), populated ? ["2", "beta", "alpha", other, key] : ["2", "alpha", key]);
}
