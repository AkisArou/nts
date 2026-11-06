/*---
description: "Constructor parameter default and nullable field selection for missing. Route: constructor default feeding class field (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Constructor parameter default and nullable field selection for missing. Route: constructor default feeding class field. Node prints defaults-constructor-missing:ok.
class Settings {
  value: number;
  constructor(value?: number | null) { const bound = value === undefined ? 1 : value; this.value = bound === null || bound === undefined ? 3 : bound; }
}
assert.sameValue(new Settings().value, 1);
console.log("defaults-constructor-missing:ok");
