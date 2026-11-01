/*---
description: "A named rest binding reads an own non-enumerable while the copy contains only class data and symbols."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-index-signatures, ts-symbols, ts-computed-keys, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-errors, ts-literal-types, ts-closures, ts-destructuring, ts-spread]
---*/
// A computed message binding crosses ErrorView before rest; node reads the hidden named value once and excludes all non-enumerables and inherited members from the copy.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
const token = Symbol("field");
interface ErrorView extends Error { "2"?: CopyValue; detail?: CopyValue; [token]?: CopyValue; }
type CopyTable = { [key: string]: unknown; [key: symbol]: unknown };
function inspect(input: CopyValue): void {
  const log: unknown[] = [];
  class DataFault extends Error {
    "2": CopyValue; detail: CopyValue; [token]: CopyValue;
    constructor(value: CopyValue) { super("hidden", { cause: first }); this["2"] = value; this.detail = value; this[token] = replacement; }
    get inherited(): CopyValue { log.push("inherited.get", this.detail); return this.detail; }
    method(): CopyValue { log.push("method", this.detail); return this.detail; }
  }
  const rows: { source: ErrorView; fields: boolean }[] = [{ source: new Error("hidden", { cause: first }), fields: false }, { source: new DataFault(input), fields: true }, { source: Object.freeze(new DataFault(input)), fields: true }];
  for (const row of rows) {
    log.length = 0; const source = row.source;
    function key(): "message" { log.push("key", source.message); return "message"; }
    const { [key()]: chosen, ...remaining } = source; const copy: CopyTable = remaining;
    const keys = row.fields ? ["2", "detail"] : [], symbols = row.fields ? [token] : [];
    order(copy, keys); order(source, keys); assert.compareArray(Object.getOwnPropertySymbols(copy), symbols); same(Object.is(copy, source), false);
    same(copy["2"], row.fields ? input : undefined); same(copy.detail, row.fields ? input : undefined); same(copy[token], row.fields ? replacement : undefined);
    for (const key of ["message", "stack", "cause"]) { same(Object.hasOwn(source, key), true); same(Object.hasOwn(copy, key), false); same(copy[key], undefined); }
    same(source.message, "hidden"); same(source.cause, first); same(typeof source.stack, "string"); same("inherited" in copy, false); same("method" in copy, false);
    same(chosen, "hidden"); same(Object.isFrozen(copy), false);
    assert.compareArray(log, ["key", "hidden"]);
  }
}
for (const input of inputs) inspect(input);
