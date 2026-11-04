/*---
description: "Plain Error messages and causes stay out of keys, JSON, object spread and for-in."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-objects, ts-spread]
flags: [module]
---*/
// Plain Error messages and causes stay out of keys, JSON, object spread and for-in. Route: a readonly Error array with omitted, empty and supplied fields.
// Node prints: construction-enumeration-plain-readonly:ok
const marker = { id: 7 };
const values: readonly Error[] = [new Error(), new Error(""), new Error("m", { cause: marker }), new Error(undefined, { cause: undefined })];
for (const value of values) {
  const copy = { ...value }, walked: string[] = [];
  for (const key in value) walked.push(key);
  assert.compareArray(Object.keys(value), []);
  assert.sameValue(JSON.stringify(value), "{}");
  assert.compareArray(Object.keys(copy), []);
  assert.compareArray(walked, []);
}
console.log("construction-enumeration-plain-readonly:ok");
