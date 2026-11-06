/*---
description: "Constructor parameter default and nullable field selection for missing. Route: constructor default feeding class field"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Constructor parameter default and nullable field selection for missing. Route: constructor default feeding class field. Node prints defaults-constructor-missing:ok.
class Settings {
  value: number;
  constructor(value: number | null = 1) { this.value = value ?? 3; }
}
assert.sameValue(new Settings().value, 1);
console.log("defaults-constructor-missing:ok");
