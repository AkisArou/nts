/*---
description: A `declare global` block in a module types a global the module installs; reads then reach it.
features: [ts-ambient, ts-modules]
flags: [module]
---*/
declare global {
  var appSettings: { theme: string } | undefined;
}
export {};
globalThis.appSettings = { theme: "dark" };
assert.sameValue(appSettings?.theme, "dark");
assert.sameValue(globalThis.appSettings === appSettings, true);
