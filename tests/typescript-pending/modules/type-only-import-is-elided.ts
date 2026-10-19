/*---
description: A plain import whose bindings are used only as types is elided, so the module it names is not evaluated.
features: [ts-modules, ts-imports, ts-import-type]
flags: [module]
---*/
import { Shape, Unit } from "./shape-types_FIXTURE.js";
const unit: Unit = "cm";
const circle: Shape = { area: () => 3 };
assert.sameValue(`${circle.area()}${unit}`, "3cm");
assert.sameValue((globalThis as { evaluated?: string[] }).evaluated, undefined);
