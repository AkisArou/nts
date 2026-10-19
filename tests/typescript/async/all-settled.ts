/*---
description: Promise.allSettled results are a union discriminated by status, narrowed to read value or reason.
features: [ts-async, ts-discriminated-unions, ts-narrowing]
flags: [async]
---*/
async function maybe(n: number): Promise<number> {
  if (n < 0) throw new Error(`negative ${n}`);
  return n * 2;
}
async function main(): Promise<void> {
  const results = await Promise.allSettled([maybe(1), maybe(-2), maybe(3)]);
  const summary = results.map((r) => (r.status === "fulfilled" ? `ok ${r.value}` : `no ${(r.reason as Error).message}`));
  assert.compareArray(summary, ["ok 2", "no negative -2", "ok 6"]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
