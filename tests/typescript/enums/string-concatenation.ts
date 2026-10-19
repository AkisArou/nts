/*---
description: A string member may be built from earlier string members by concatenation and template literals.
features: [ts-enum, ts-enum-string, ts-enum-computed]
---*/
enum Path { Root = "/", Api = Root + "api", Users = `${Api}/users` }
assert.sameValue(Path.Api, "/api");
assert.sameValue(Path.Users, "/api/users");
assert.sameValue(Object.keys(Path).length, 3);
