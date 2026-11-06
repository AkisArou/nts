/*---
description: "Constructor parameter default and nullable field selection for null. Route: constructor default feeding class field (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Constructor parameter default and nullable field selection for null. Route: constructor default feeding class field. Node prints defaults-constructor-null:ok.
class Settings {
  value: number;
  constructor(value?: number | null) { const bound = value === undefined ? 1 : value; this.value = bound === null || bound === undefined ? 3 : bound; }
}
assert.sameValue(new Settings(null).value, 3);
console.log("defaults-constructor-null:ok");
