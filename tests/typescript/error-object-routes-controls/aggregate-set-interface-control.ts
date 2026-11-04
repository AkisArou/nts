/*---
description: "Aggregate members retain each Set insertion order after interface-dispatched clearing through an interface with two Set providers."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-map-set, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate members retain each Set insertion order after interface-dispatched clearing; route: an interface with two Set providers.
// Node prints: aggregate-set-interface:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
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
  const aggregate = new Fault(provider.read(), [[marker, "first"], [undefined, marker, "second"]][i], "many", "AggregateError: many");
  const members: readonly unknown[] = aggregate.errors;
  provider.change();
  assert.compareArray(Array.from(provider.read()), ["changed"]);
  assert.compareArray(members, expected[i]);
  assert.sameValue(members.includes(marker), true);
  assert.sameValue(true, true);
  assert.compareArray([], []);
  assert.sameValue(aggregate.text, "AggregateError: many");
}
console.log("aggregate-set-interface:ok");
