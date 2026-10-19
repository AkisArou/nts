/*---
description: A default import and named imports from one module refer to the same class and values.
features: [ts-modules, ts-imports, ts-exports, ts-class]
flags: [module]
---*/
import Widget, { defaultSize, make } from "./widget_FIXTURE.js";
import { default as SameWidget } from "./widget_FIXTURE.js";
const made = make();
assert.sameValue(made instanceof Widget, true);
assert.sameValue(made.size, defaultSize);
assert.sameValue(SameWidget, Widget);
