/*---
description: An own class cast to AggregateError keeps its constructor and error list.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-arrays, ts-unknown, ts-instanceof]
---*/
// Route: a class is asserted to be AggregateError; node keeps its own fields and class.
let calls = 0;
class OwnAggregate {
  readonly name: string = "OwnAggregate";
  readonly message: string;
  readonly errors: number[];
  constructor(errors: number[], message: string) {
    calls++; this.message = "own:" + message; this.errors = [errors[0] + 100];
  }
}
function check(n: number): void {
  calls = 0;
  const Target = OwnAggregate as unknown as typeof AggregateError;
  const message = "item:" + n;
  const value = new Target([n], message);
  const errors: readonly unknown[] = value.errors;
  assert.sameValue(calls, 1);
  assert.sameValue(value.name, "OwnAggregate");
  assert.sameValue(value.message, "own:" + message);
  assert.sameValue(errors.length, 1);
  assert.sameValue(errors[0], n + 100);
  assert.sameValue(value instanceof OwnAggregate, true);
  assert.sameValue(value instanceof AggregateError, false);
}
for (const n of [-3, 0, 1, 7]) check(n);
