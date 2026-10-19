/*---
description: Keys typed as keyof an object index it to values of each property's type.
features: [ts-type-operators, ts-keyof]
---*/
const limits = { cpu: 4, memory: 16, disk: 256 };
type Resource = keyof typeof limits;
const resources = Object.keys(limits) as Resource[];
let total = 0;
for (const resource of resources) total += limits[resource];
assert.sameValue(total, 276);
assert.sameValue(resources.join(","), "cpu,memory,disk");
