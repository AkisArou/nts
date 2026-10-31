/*---
description: An async function reached through a typed field preserves its result, rejection and finally state.
features: [ts-call-route-suspension, ts-async, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-objects]
flags: [async]
---*/
// Route: a function-typed field reaches an async body; node awaits its result or catches its rejection after callee cleanup.
const log: string[] = [];
let state = 0;
async function produce(n: number): Promise<number> {
  log.push(`enter:${n}:${state}`);
  try {
    state = n;
    await Promise.resolve();
    log.push(`resume:${state}`);
    if (n < 0) throw new RangeError(`route:${n}`);
    return state * 2;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const holder: { run: (n: number) => Promise<number> } = { run: produce };
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    state = 0; log.length = 0;
    let returned: number | undefined;
    try {
      returned = await holder.run(n);
      log.push(`return:${returned}:${state}`);
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      assert.sameValue(error.message, `route:${n}`);
      log.push(`catch:${error.message}:${state}`);
    } finally { state += 100; log.push(`caller-finally:${state}`); }
    assert.sameValue(returned, n < 0 ? undefined : n * 2);
    assert.sameValue(state, n + 110);
    const completion = n < 0 ? `catch:route:${n}:${n + 10}` : `return:${n * 2}:${n + 10}`;
    assert.compareArray(log, [`enter:${n}:0`, `resume:${n}`, `callee-finally:${n + 10}`,
      completion, `caller-finally:${n + 110}`]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
