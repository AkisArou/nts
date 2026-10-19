/*---
description: `import x = require()` of a module that ends with `export =` binds the exported object itself.
features: [ts-commonjs, ts-export-equals, ts-import-require]
---*/
import counter = require("./counter_FIXTURE.js");
assert.sameValue(counter.next(), 1);
assert.sameValue(counter.next(), 2);
assert.sameValue(counter.current, 2);
