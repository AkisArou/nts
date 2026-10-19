/*---
description: An enum and a namespace imported from another module keep their objects, reverse mapping included.
features: [ts-modules, ts-imports, ts-enum, ts-namespace]
flags: [module]
---*/
import { Level, Levels } from "./kinds_FIXTURE.js";
assert.sameValue(Level.High, 2);
assert.sameValue(Level[1], "Low");
assert.sameValue(Levels.label(Level.High), "high");
