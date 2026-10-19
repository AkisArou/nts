/*---
description: Functions typed with Pick and Omit build objects holding exactly the chosen keys.
features: [ts-objects, ts-utility-types, ts-keyof, ts-generics]
---*/
function pick<T, K extends keyof T>(object: T, ...keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = object[key];
  return out;
}
function omit<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const out = { ...object };
  for (const key of keys) delete out[key];
  return out;
}
const user = { id: 1, login: "kim", secret: "s" };
assert.sameValue(Object.keys(pick(user, "login", "id")).join(","), "login,id");
assert.sameValue(Object.keys(omit(user, "secret")).join(","), "id,login");
assert.sameValue(pick(user, "login").login, "kim");
