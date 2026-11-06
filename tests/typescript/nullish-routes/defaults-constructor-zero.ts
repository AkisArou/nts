/*---
description: "Constructor parameter default and nullable field selection for zero. Route: constructor default feeding class field"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Constructor parameter default and nullable field selection for zero. Route: constructor default feeding class field. Node prints defaults-constructor-zero:ok.
class Settings {
  value: number;
  constructor(value: number | null = 1) { this.value = value ?? 3; }
}
assert.sameValue(new Settings(0).value, 0);
console.log("defaults-constructor-zero:ok");
