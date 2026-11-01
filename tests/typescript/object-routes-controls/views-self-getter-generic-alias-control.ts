/*---
description: "Control for views-self-getter-generic-alias; An own or inherited self getter returns the original object through a generic interface route and keeps later writes shared."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-optional-properties, ts-closures]
---*/
// Recursive SelfView and Record aliases share p after generic self reads; node logs each current payload and preserves original receiver identity and key ownership. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type SelfCell = { p: ViewValue; "2": ViewValue; self?: SelfCell; maybe?: ViewValue };
function inspect(input: ViewValue, inherited: boolean, present: boolean): void {
  const log: unknown[] = [], source: SelfCell = { p: input, "2": input }; let hasSelf = false, hasMaybe = false;
  if (!inherited) { source.self = source; hasSelf = true; } if (present) { source.maybe = undefined; hasMaybe = true; }
  function getSelf(value: SelfCell): SelfCell { log.push("self", value.p); return value; }
  const table = source, returned = getSelf(source); same(returned, source); same(table, source);
  returned.p = marker; log.push("returned", source.p); same(source.p, marker); source.p = replacement;
  const again = getSelf(returned); same(again, source); log.push("again", again.p); same(source.p, replacement);
  again.p = input; log.push("final", source.p); same(source.p, input); same(source.p, input); same(source["2"], input);
  const keys = inherited ? ["2", "p"] : ["2", "p", "self"]; if (present) keys.push("maybe"); order(source, keys);
  same(hasSelf, !inherited); same(hasMaybe, present);
  same(source.maybe, undefined); assert.compareArray(log, ["self", input, "returned", marker, "self", replacement, "again", replacement, "final", input]);
}
for (const input of inputs) for (const inherited of [false, true]) for (const present of [false, true]) inspect(input, inherited, present);
