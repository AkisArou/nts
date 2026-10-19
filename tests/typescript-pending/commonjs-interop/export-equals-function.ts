/*---
description: A module whose `export =` is a function is imported as a callable binding.
features: [ts-commonjs, ts-export-equals, ts-import-require, ts-functions]
---*/
import greet = require("./greet_FIXTURE.js");
assert.sameValue(greet("kim"), "hello kim");
assert.sameValue(typeof greet, "function");
assert.sameValue(greet.name, "greet");
