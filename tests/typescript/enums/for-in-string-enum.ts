/*---
description: for-in over a string enum visits its member names, in declaration order.
features: [ts-enum, ts-enum-string]
---*/
enum Suit { Hearts = "H", Spades = "S", Clubs = "C" }
const names: string[] = [];
for (const name in Suit) names.push(name);
assert.sameValue(names.join(","), "Hearts,Spades,Clubs");
