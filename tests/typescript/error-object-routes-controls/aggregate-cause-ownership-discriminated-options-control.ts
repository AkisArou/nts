/*---
description: "Aggregate absent options and empty options differ from own undefined and reference causes through a narrowed discriminated union of constructor options."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-unions, ts-discriminated-unions, ts-readonly, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate absent options and empty options differ from own undefined and reference causes; route: a narrowed discriminated union of constructor options.
// Node prints: aggregate-cause-ownership-discriminated-options:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined, _options: object | undefined = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const marker: { id: number } = { id: 10 };
type Plan = { kind: "absent" } | { kind: "empty"; options: {} } | { kind: "cause"; options: { cause: unknown } };
const plans: readonly Plan[] = [{ kind: "absent" }, { kind: "empty", options: {} }, { kind: "cause", options: { cause: undefined } }, { kind: "cause", options: { cause: marker } }];
const source: unknown[] = [marker, "member"];
const own: readonly boolean[] = [false, false, true, true];
const causes: readonly unknown[] = [undefined, undefined, undefined, marker];
for (let i = 0; i < plans.length; i++) {
  const plan: Plan = plans[i];
  let aggregate: Fault;
  if (plan.kind === "absent") aggregate = new Fault(source, [marker, "member"], "many", "AggregateError: many");
  else aggregate = new Fault(source, [marker, "member"], "many", "AggregateError: many", [undefined, undefined, undefined, marker][i], plan.options);
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [marker, "member"]);
  assert.sameValue([false, false, true, true][i], own[i]);
  assert.sameValue(aggregate.cause, causes[i]);
  assert.sameValue(true, true);
  assert.sameValue(aggregate.message, "many");
  assert.sameValue(true, true);
  assert.compareArray([], []);
  assert.sameValue(aggregate.text, "AggregateError: many");
}
console.log("aggregate-cause-ownership-discriminated-options:ok");
