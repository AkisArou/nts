/*---
description: A `declare const enum` has no object at run time; TypeScript inlines each member's value at its use.
features: [ts-enum, ts-const-enum, ts-ambient]
---*/
declare const enum Flags { Read = 1, Write = 2, Both = Read | Write }
const mask: number = Flags.Both;
assert.sameValue(mask, 3);
assert.sameValue(Flags.Write & mask, 2);
