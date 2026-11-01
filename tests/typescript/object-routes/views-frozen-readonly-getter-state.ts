/*---
description: "Frozen readonly views retain live external getter state while a frozen data property keeps its original value."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-interfaces, ts-index-signatures, ts-record, ts-class, ts-class-fields, ts-declare-field, ts-generics, ts-generic-constraints, ts-readonly, ts-utility-types, ts-accessors, ts-optional-properties, ts-closures]
---*/
// Interface, Readonly Record and generic reads observe frozen own or inherited getters after external writes; node never treats freezing as a snapshot of getter results.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface FrozenView { readonly p: ViewValue }
function read<T extends FrozenView>(value: T): ViewValue { return value.p; }
function inspect(input: ViewValue, kind: "class" | "accessor" | "data", present: boolean): void {
  const log: unknown[] = [], state: { p: ViewValue } = { p: input };
  class FrozenCell {
    readonly [key: string]: ViewValue; "2": ViewValue = input; declare maybe?: ViewValue;
    get p(): ViewValue { log.push("get", state.p); return state.p; }
  }
  let source: { [key: string]: ViewValue; readonly p: ViewValue; maybe?: ViewValue } = new FrozenCell();
  if (kind === "accessor") source = { get p(): ViewValue { log.push("get", state.p); return state.p; }, "2": input };
  if (kind === "data") source = { p: input, "2": input };
  if (present) source.maybe = undefined;
  const frozen = Object.freeze(source), view: FrozenView = frozen, table: Readonly<Record<string, ViewValue>> = frozen;
  same(frozen, source); same(view, source); same(table, source); same(Object.isFrozen(source), true);
  const first = view.p; log.push("interface", first); state.p = marker;
  const second = table.p; log.push("record", second); state.p = replacement;
  const third = read(frozen); log.push("generic", third);
  same(first, input); same(second, kind === "data" ? input : marker); same(third, kind === "data" ? input : replacement); same(state.p, replacement); same(source["2"], input);
  const keys = kind === "class" ? ["2"] : ["2", "p"]; if (present) keys.push("maybe"); order(source, keys); same(Object.hasOwn(source, "p"), kind !== "class"); same(Object.hasOwn(source, "maybe"), present);
  let expected: unknown[] = ["interface", input, "record", input, "generic", input]; if (kind !== "data") expected = ["get", input, "interface", input, "get", marker, "record", marker, "get", replacement, "generic", replacement];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
const kinds: ("class" | "accessor" | "data")[] = ["class", "accessor", "data"];
for (const input of inputs) for (const kind of kinds) for (const present of [false, true]) inspect(input, kind, present);
