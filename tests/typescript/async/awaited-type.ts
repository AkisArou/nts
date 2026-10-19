/*---
description: Awaited<ReturnType<F>> types the value an async function's promise resolves to.
features: [ts-async, ts-utility-types]
flags: [async]
---*/
async function fetchUser(id: number) {
  return { id, login: `user${id}`, tags: ["a"] };
}
type User = Awaited<ReturnType<typeof fetchUser>>;
async function main(): Promise<void> {
  const user: User = await fetchUser(7);
  const copy: User = { ...user, tags: [...user.tags, "b"] };
  assert.sameValue(user.login, "user7");
  assert.compareArray(copy.tags, ["a", "b"]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
