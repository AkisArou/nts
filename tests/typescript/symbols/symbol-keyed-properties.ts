/*---
description: Symbol-keyed properties are read by their symbol and are absent from Object.keys and JSON.
features: [ts-symbols]
---*/
const id = Symbol("id");
const user = { [id]: 7, login: "kim" };
assert.sameValue(user[id], 7);
assert.sameValue(Object.keys(user).join(","), "login");
assert.sameValue(Object.getOwnPropertySymbols(user)[0], id);
assert.sameValue(JSON.stringify(user), '{"login":"kim"}');
assert.sameValue(id in user, true);
