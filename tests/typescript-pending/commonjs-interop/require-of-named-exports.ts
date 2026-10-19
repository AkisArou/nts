/*---
description: `import x = require()` of a module with named exports binds its exports object, whose members are the exports.
features: [ts-commonjs, ts-import-require, ts-exports]
---*/
import lib = require("./exports_FIXTURE.js");
assert.sameValue(lib.version, "1.0");
assert.sameValue(lib.major(), 1);
assert.compareArray(Object.keys(lib).sort(), ["major", "version"]);
