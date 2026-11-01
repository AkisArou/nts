/*---
description: "An own or inherited self getter returns the original object through a generic interface route and keeps later writes shared."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-index-signatures, ts-record, ts-class, ts-class-fields, ts-generics, ts-generic-constraints, ts-accessors, ts-readonly, ts-closures]
---*/
// Recursive SelfView and Record aliases share p after generic self reads; node logs each current payload and preserves original receiver identity and key ownership.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface SelfView { [key: string]: unknown; p: ViewValue; readonly self: SelfView }
function aliasOf<T extends SelfView>(value: T): SelfView { return value.self; }
function inspect(input: ViewValue, inherited: boolean, present: boolean): void {
  const log: unknown[] = [];
  class SelfCell {
    [key: string]: unknown; p: ViewValue = input; "2": ViewValue = input;
    get self(): SelfView { log.push("self", this.p); return this; }
  }
  let source: SelfView = new SelfCell();
  if (!inherited) source = { p: input, "2": input, get self(): SelfView { log.push("self", this.p); return this; } };
  if (present) source.maybe = undefined;
  const table: Record<string, unknown> = source, returned = aliasOf(source); same(returned, source); same(table, source);
  returned.p = marker; log.push("returned", table.p); same(source.p, marker); table.p = replacement;
  const again = aliasOf(returned); same(again, source); log.push("again", again.p); same(source.p, replacement);
  again.p = input; log.push("final", table.p); same(source.p, input); same(table.p, input); same(source["2"], input);
  const keys = inherited ? ["2", "p"] : ["2", "p", "self"]; if (present) keys.push("maybe"); order(source, keys);
  same(Object.hasOwn(source, "self"), !inherited); same(Object.hasOwn(source, "maybe"), present);
  same(source.maybe, undefined); assert.compareArray(log, ["self", input, "returned", marker, "self", replacement, "again", replacement, "final", input]);
}
for (const input of inputs) for (const inherited of [false, true]) for (const present of [false, true]) inspect(input, inherited, present);
