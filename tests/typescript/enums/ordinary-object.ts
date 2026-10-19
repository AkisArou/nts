/*---
description: An enum object is an ordinary, unfrozen object.
features: [ts-enum]
---*/
enum Mode { On, Off }
assert.sameValue(typeof Mode, "object");
assert.sameValue(Object.isFrozen(Mode), false);
assert.sameValue(Object.getPrototypeOf(Mode), Object.prototype);
