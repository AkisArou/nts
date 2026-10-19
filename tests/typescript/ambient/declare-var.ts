/*---
description: A `declare var` emits nothing; the name resolves to the global property the program sets at run time.
features: [ts-ambient]
---*/
declare var injectedLimit: number;
(globalThis as { injectedLimit?: number }).injectedLimit = 12;
assert.sameValue(injectedLimit, 12);
assert.sameValue(injectedLimit * 2, 24);
