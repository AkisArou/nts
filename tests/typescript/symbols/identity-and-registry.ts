/*---
description: Each Symbol() call makes a new symbol; Symbol.for returns one symbol per key from the global registry.
features: [ts-symbols]
---*/
const a: symbol = Symbol("same");
const b: symbol = Symbol("same");
assert.sameValue(a === b, false);
const shared = Symbol.for("app.key");
assert.sameValue(shared === Symbol.for("app.key"), true);
assert.sameValue(Symbol.keyFor(shared), "app.key");
assert.sameValue(Symbol.keyFor(a), undefined);
