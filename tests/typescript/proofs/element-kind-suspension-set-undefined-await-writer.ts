/*---
description: An async writer adds a present undefined while the caller is suspended.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-null-undefined, ts-async, ts-arrow-functions, ts-closures, ts-unknown]
flags: [async]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: a nested async writer first suspends, then conditionally inserts undefined before the awaiting caller resumes.
function check(items: Set<number | undefined>, changed: boolean): void {
  const iterator = items.values();
  const first = iterator.next(), second = iterator.next(), third = iterator.next();
  assert.sameValue(first.done, false);
  assert.sameValue(first.value, 1);
  assert.sameValue(second.done, false);
  assert.sameValue(second.value, 2);
  assert.sameValue(third.done, !changed);
  assert.sameValue(third.value, undefined);
  const end = iterator.next();
  assert.sameValue(end.done, true);
  assert.sameValue(end.value, undefined);
  assert.sameValue(items.has(undefined), changed);
  assert.sameValue(items.size, changed ? 3 : 2);
}
async function observe(n: number): Promise<Set<number | undefined>> {
  const items = new Set<number | undefined>([1, 2]);
  check(items, false);
  async function write(): Promise<void> {
    await Promise.resolve();
    if (n > 0) items.add(undefined);
  }
  await write();
  return items;
}
async function checkAll(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) check(await observe(n), n > 0);
}
checkAll().then(() => $DONE(), (error: unknown) => $DONE(error));
