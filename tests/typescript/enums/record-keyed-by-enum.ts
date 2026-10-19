/*---
description: A Record keyed by a numeric enum stores each member under its number's string.
features: [ts-enum, ts-record, ts-computed-keys]
---*/
enum Tier { Free, Pro, Team }
const price: Record<Tier, number> = { [Tier.Free]: 0, [Tier.Pro]: 9, [Tier.Team]: 29 };
assert.sameValue(price[Tier.Pro], 9);
assert.sameValue(Object.keys(price).join(","), "0,1,2");
const pro: number = price[1 as Tier];
assert.sameValue(pro, 9);
