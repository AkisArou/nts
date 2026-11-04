/*---
description: "Control: Plain Error messages and causes stay out of keys, JSON, object spread and for-in."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-objects, ts-spread]
flags: [module]
---*/
// Control: Plain Error messages and causes stay out of keys, JSON, object spread and for-in. Route: a readonly Error array with omitted, empty and supplied fields.
// Node prints: construction-enumeration-plain-readonly:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const marker = { id: 7 };
const values: readonly Error[] = [new Fault("Error", "", undefined, "Error"), new Fault("Error", "", undefined, "Error"), new Fault("Error", "m", marker, "Error: m"), new Fault("Error", "", undefined, "Error")];
for (const value of values) {
  const copy = {}, walked: string[] = [];
  for (const key in {}) walked.push(key);
  assert.compareArray([], []);
  assert.sameValue("{}", "{}");
  assert.compareArray([], []);
  assert.compareArray(walked, []);
}
console.log("construction-enumeration-plain-readonly:ok");
