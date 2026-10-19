/*---
description: An imported let is a live binding: the importer sees each assignment the exporting module makes.
features: [ts-modules, ts-imports]
flags: [module]
---*/
import { count, increment } from "./counter_FIXTURE.js";
assert.sameValue(count, 0);
increment();
increment();
assert.sameValue(count, 2);
