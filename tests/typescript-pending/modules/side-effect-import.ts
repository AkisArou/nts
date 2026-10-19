/*---
description: A side-effect import is kept and evaluates its module once, before the importer's body, however often it is named.
features: [ts-modules, ts-imports]
flags: [module]
---*/
import "./effect_FIXTURE.js";
import "./effect_FIXTURE.js";
const effects = (globalThis as { effects?: string[] }).effects;
assert.compareArray(effects ?? [], ["effect"]);
