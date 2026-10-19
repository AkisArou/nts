/*---
description: A generic async retry over a typed operation, with errors caught as unknown, attempts counted in a closure, and a typed result union.
features: [ts-async, ts-generics, ts-errors, ts-unknown, ts-closures, ts-discriminated-unions]
flags: [async]
---*/
type Outcome<T> = { ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number };
async function retry<T>(operation: (attempt: number) => Promise<T>, limit: number): Promise<Outcome<T>> {
  let attempts = 0;
  let last = "none";
  while (attempts < limit) {
    attempts++;
    try {
      return { ok: true, value: await operation(attempts), attempts };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: last, attempts };
}
async function main(): Promise<void> {
  const flaky = await retry(async (n) => {
    if (n < 3) throw new Error(`fail ${n}`);
    return `done on ${n}`;
  }, 5);
  assert.sameValue(flaky.ok && flaky.value, "done on 3");
  const hopeless = await retry<number>(async () => Promise.reject("nope"), 2);
  assert.sameValue(hopeless.ok ? "" : `${hopeless.error}/${hopeless.attempts}`, "nope/2");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
