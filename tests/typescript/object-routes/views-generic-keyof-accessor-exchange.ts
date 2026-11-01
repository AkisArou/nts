/*---
description: "A generic keyed exchange returns the pre-write value and dispatches each accessor through later Record writes."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-literal-types, ts-interfaces, ts-index-signatures, ts-record, ts-generics, ts-generic-constraints, ts-keyof, ts-indexed-access, ts-accessors, ts-optional-properties]
---*/
// Exchange<T,K> visits p or numeric key 2 on data and accessor shapes; node preserves old values, setter order and every shared readback.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface ExchangeView { [key: string]: ViewValue; p: ViewValue; "2": ViewValue; tail: ViewValue; maybe?: ViewValue }
function exchange<T, K extends keyof T>(value: T, key: K, next: T[K]): T[K] { const previous = value[key]; value[key] = next; return previous; }
function inspect(input: ViewValue, accessor: boolean, key: "p" | "2", present: boolean): void {
  const log: unknown[] = [], state: { p: ViewValue } = { p: input };
  const source: ExchangeView = accessor ? { get p(): ViewValue { log.push("get", state.p); return state.p; }, set p(value: ViewValue) { log.push("set", value); state.p = value; }, "2": input, tail: marker } : { p: input, "2": input, tail: marker };
  if (present) source.maybe = undefined;
  const table: Record<string, ViewValue> = source; same(table, source);
  const first = exchange(source, key, replacement); log.push("first", first);
  const middle = table[key]; log.push("table", middle); table[key] = marker;
  const last = exchange(source, key, input); log.push("last", last);
  const final = source[key]; log.push("final", final); const finalP = source.p; same(finalP, input);
  same(first, input); same(middle, replacement); same(last, marker); same(final, input); same(source["2"], input); same(source.tail, marker);
  const keys = ["2", "p", "tail"]; if (present) keys.push("maybe"); order(source, keys); same(Object.hasOwn(source, "maybe"), present);
  let expected: unknown[] = ["first", input, "table", replacement, "last", marker, "final", input];
  if (accessor && key === "p") expected = ["get", input, "set", replacement, "first", input, "get", replacement, "table", replacement, "set", marker, "get", marker, "set", input, "last", marker, "get", input, "final", input];
  if (accessor) expected.push("get", input); same(source.maybe, undefined); assert.compareArray(log, expected);
}
const routeKeys: ("p" | "2")[] = ["p", "2"];
for (const input of inputs) for (const accessor of [false, true]) for (const key of routeKeys) for (const present of [false, true]) inspect(input, accessor, key, present);
