/*---
description: ReturnType and Parameters of a function type locals that hold its results and arguments.
features: [ts-type-operators, ts-utility-types, ts-typeof-type]
---*/
function makeUser(login: string, admin = false) {
  return { login, admin, created: 1 };
}
type User = ReturnType<typeof makeUser>;
type Args = Parameters<typeof makeUser>;
const args: Args = ["kim", true];
const user: User = makeUser(...args);
const copy: User = { ...user, login: "lee" };
assert.sameValue(user.admin, true);
assert.sameValue(copy.login, "lee");
assert.sameValue(copy.created, 1);
