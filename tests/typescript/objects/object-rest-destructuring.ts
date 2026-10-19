/*---
description: Object rest destructuring collects the properties not named, as a new object.
features: [ts-objects, ts-destructuring, ts-spread]
---*/
type User = { id: number; login: string; email: string; admin: boolean };
const user: User = { id: 1, login: "kim", email: "k@x", admin: false };
const { id, ...profile } = user;
assert.sameValue(id, 1);
assert.sameValue(Object.keys(profile).join(","), "login,email,admin");
profile.login = "changed";
assert.sameValue(user.login, "kim");
