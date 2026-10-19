/*---
description: `??=`, `||=` and `&&=` assign only when the current value is nullish, falsy or truthy.
features: [ts-objects, ts-null-undefined]
---*/
type Prefs = { theme?: string; retries: number; verbose: boolean };
const prefs: Prefs = { retries: 0, verbose: true };
prefs.theme ??= "dark";
prefs.theme ??= "light";
prefs.retries ||= 3;
prefs.verbose &&= false;
assert.sameValue(prefs.theme, "dark");
assert.sameValue(prefs.retries, 3);
assert.sameValue(prefs.verbose, false);
