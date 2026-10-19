/*---
description: A function merged with a namespace and exported by `export =` brings both its call and its namespace members and types.
features: [ts-commonjs, ts-export-equals, ts-import-require, ts-namespace, ts-declaration-merging]
---*/
import format = require("./format_FIXTURE.js");
const options: format.Options = { digits: 0 };
assert.sameValue(format(3.14159), "3.14");
assert.sameValue(format(2.5, options), "3");
assert.sameValue(format.defaultDigits, 2);
