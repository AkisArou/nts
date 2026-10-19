/*---
description: A Record over a literal union key holds one value per key and iterates in insertion order.
features: [ts-objects, ts-record, ts-literal-types]
---*/
type Day = "mon" | "tue" | "wed";
const hours: Record<Day, number> = { mon: 8, tue: 6, wed: 7 };
hours.tue += 2;
let total = 0;
for (const day of Object.keys(hours) as Day[]) total += hours[day];
assert.sameValue(total, 23);
assert.sameValue(Object.keys(hours).join(","), "mon,tue,wed");
