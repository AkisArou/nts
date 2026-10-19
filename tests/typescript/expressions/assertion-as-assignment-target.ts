/*---
description: An asserted expression can be the target of an assignment and of a compound assignment.
features: [ts-type-assertions]
---*/
const record: Record<string, unknown> = { count: 1 };
(record.count as number) = 5;
(record as { count: number }).count += 2;
(<{ label?: string }>record).label = "x";
assert.sameValue(record.count, 7);
assert.sameValue(record.label, "x");
