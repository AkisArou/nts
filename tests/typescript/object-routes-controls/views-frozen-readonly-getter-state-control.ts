/*---
description: "Control for views-frozen-readonly-getter-state; Frozen readonly views retain live external getter state while a frozen data property keeps its original value."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-readonly, ts-optional-properties, ts-closures]
---*/
// Interface, Readonly Record and generic reads observe frozen own or inherited getters after external writes; node never treats freezing as a snapshot of getter results. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type FrozenCell = { "2": ViewValue; p?: ViewValue; maybe?: ViewValue };
function inspect(input: ViewValue, kind: "class" | "accessor" | "data", present: boolean): void {
  const log: unknown[] = [], state: { p: ViewValue } = { p: input }, source: FrozenCell = { "2": input }; let hasP = false, hasMaybe = false;
  if (kind !== "class") { source.p = input; hasP = true; } if (present) { source.maybe = undefined; hasMaybe = true; }
  const frozen = Object.freeze(source), view = source, table = source;
  same(frozen, source); same(view, source); same(table, source); same(Object.isFrozen(source), true);
  function read(): ViewValue { if (kind !== "data") { log.push("get", state.p); return state.p; } return source.p; }
  const first = read(); log.push("interface", first); state.p = marker;
  const second = read(); log.push("record", second); state.p = replacement;
  const third = read(); log.push("generic", third);
  same(first, input); same(second, kind === "data" ? input : marker); same(third, kind === "data" ? input : replacement); same(state.p, replacement); same(source["2"], input);
  const keys = kind === "class" ? ["2"] : ["2", "p"]; if (present) keys.push("maybe"); order(source, keys); same(hasP, kind !== "class"); same(hasMaybe, present);
  let expected: unknown[] = ["interface", input, "record", input, "generic", input]; if (kind !== "data") expected = ["get", input, "interface", input, "get", marker, "record", marker, "get", replacement, "generic", replacement];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
const kinds: ("class" | "accessor" | "data")[] = ["class", "accessor", "data"];
for (const input of inputs) for (const kind of kinds) for (const present of [false, true]) inspect(input, kind, present);
