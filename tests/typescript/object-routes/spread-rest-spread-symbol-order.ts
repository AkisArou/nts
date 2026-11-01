/*---
description: "Spread copies symbol identities after string getters and preserves symbol insertion order."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-symbols, ts-unique-symbol, ts-computed-keys, ts-keyof, ts-accessors, ts-optional-properties, ts-spread]
---*/
// An optional SymbolSource holds two distinct same-description symbols; node orders integer, string and symbol reads and keeps symbol presence even for undefined.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
const tokenA = Symbol("same"), tokenB = Symbol("same");
interface SymbolSource { [tokenA]?: CopyValue; [tokenB]?: CopyValue; "2"?: CopyValue; label?: CopyValue; }
function copyOf(source: SymbolSource, keys: (keyof SymbolSource)[]): SymbolSource { return { ...source }; }
function inspect(input: CopyValue, mode: string): void {
  const log: unknown[] = []; let source: SymbolSource = {};
  if (mode === "getters") source = { get [tokenB](): CopyValue { log.push("get.B", input); return input; }, get label(): CopyValue { log.push("get.label", first); return first; },
    get [tokenA](): CopyValue { log.push("get.A", replacement); return replacement; }, get 2(): CopyValue { log.push("get.2", input); return input; } };
  else if (mode === "undefined") source = { [tokenB]: undefined };
  else if (mode !== "empty") source = { [tokenB]: input, label: first, [tokenA]: replacement, "2": input };
  if (mode === "frozen") Object.freeze(source);
  const keys: (keyof SymbolSource)[] = mode === "empty" ? [] : mode === "undefined" ? [tokenB] : ["2", "label", tokenB, tokenA];
  const names: string[] = mode === "empty" || mode === "undefined" ? [] : ["2", "label"];
  const tokens = mode === "empty" ? [] : mode === "undefined" ? [tokenB] : [tokenB, tokenA];
  const values: CopyValue[] = mode === "empty" ? [] : mode === "undefined" ? [undefined] : [input, first, input, replacement];
  const copy = copyOf(source, keys); order(copy, names); order(source, names); assert.compareArray(Object.getOwnPropertySymbols(copy), tokens); assert.compareArray(Object.getOwnPropertySymbols(source), tokens);
  same(Object.is(copy, source), false); for (let at = 0; at < keys.length; at++) { same(copy[keys[at]], values[at]); same(Object.hasOwn(copy, keys[at]), true); }
  same(Object.hasOwn(copy, tokenA), mode !== "empty" && mode !== "undefined"); same(Object.hasOwn(copy, tokenB), mode !== "empty");
  assert.compareArray(log, mode === "getters" ? ["get.2", input, "get.label", first, "get.B", input, "get.A", replacement] : []);
}
for (const input of inputs) for (const mode of ["empty", "plain", "getters", "frozen", "undefined"]) inspect(input, mode);
