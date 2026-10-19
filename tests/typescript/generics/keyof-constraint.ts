/*---
description: A key constrained to keyof T reads and writes the property's own type through T[K].
features: [ts-generics, ts-generic-constraints, ts-keyof, ts-indexed-access]
---*/
function get<T, K extends keyof T>(object: T, key: K): T[K] {
  return object[key];
}
function set<T, K extends keyof T>(object: T, key: K, value: T[K]): void {
  object[key] = value;
}
const user = { login: "kim", visits: 3 };
assert.sameValue(get(user, "login").toUpperCase(), "KIM");
set(user, "visits", get(user, "visits") + 1);
assert.sameValue(user.visits, 4);
