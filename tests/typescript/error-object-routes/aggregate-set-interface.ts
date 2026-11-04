/*---
description: "Aggregate members retain each Set insertion order after interface-dispatched clearing through an interface with two Set providers."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-map-set, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate members retain each Set insertion order after interface-dispatched clearing; route: an interface with two Set providers.
// Node prints: aggregate-set-interface:ok
const marker: { id: number } = { id: 5 };
interface Source { read(): Set<unknown>; change(): void }
class First implements Source {
  values: Set<unknown> = new Set<unknown>([marker, "first", marker]);
  read(): Set<unknown> { return this.values; }
  change(): void { this.values.clear(); this.values.add("changed"); }
}
class Second implements Source {
  values: Set<unknown> = new Set<unknown>([undefined, marker, "second", undefined]);
  read(): Set<unknown> { return this.values; }
  change(): void { this.values.clear(); this.values.add("changed"); }
}
const providers: readonly Source[] = [new First(), new Second()];
const expected: readonly (readonly unknown[])[] = [[marker, "first"], [undefined, marker, "second"]];
for (let i = 0; i < providers.length; i++) {
  const provider: Source = providers[i];
  const aggregate = new AggregateError(provider.read(), "many");
  const members: readonly unknown[] = aggregate.errors;
  provider.change();
  assert.compareArray(Array.from(provider.read()), ["changed"]);
  assert.compareArray(members, expected[i]);
  assert.sameValue(members.includes(marker), true);
  assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
  assert.compareArray(Object.keys(aggregate), []);
  assert.sameValue(String(aggregate), "AggregateError: many");
}
console.log("aggregate-set-interface:ok");
