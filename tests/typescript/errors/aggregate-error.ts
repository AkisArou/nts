/*---
description: An AggregateError carries a typed list of the errors it gathers.
features: [ts-errors]
---*/
const failures = [new TypeError("a"), new RangeError("b")];
const aggregate = new AggregateError(failures, "two failed");
assert.sameValue(aggregate instanceof Error, true);
assert.sameValue(aggregate.message, "two failed");
assert.sameValue(aggregate.errors.length, 2);
assert.sameValue(aggregate.errors[1] instanceof RangeError, true);
assert.sameValue(aggregate.name, "AggregateError");
