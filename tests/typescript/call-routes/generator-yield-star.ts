/*---
description: Yield delegation calls a stored generator function and preserves its return value or throw through three cleanup steps.
features: [ts-call-route-suspension, ts-generators, ts-functions, ts-function-types, ts-iteration, ts-errors, ts-unknown]
---*/
// Route: yield* calls a function-typed value; node propagates its return or throw through callee, delegator and caller finally blocks.
const log: string[] = [];
let state = 0;
function* produce(n: number): Generator<number, number, void> {
  log.push(`enter:${n}:${state}`);
  try {
    state = n;
    yield n;
    state += 1; log.push(`resume:${state}`);
    if (n < 0) throw new RangeError(`route:${n}`);
    return state * 2;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const stored: (n: number) => Generator<number, number, void> = produce;
function* delegate(n: number): Generator<number, number, void> {
  try { return yield* stored(n); }
  finally { state += 20; log.push(`delegate-finally:${state}`); }
}
for (const n of [-2, 0, 3]) {
  state = 0; log.length = 0;
  let returned: number | undefined;
  try {
    const sequence = delegate(n);
    const first = sequence.next();
    assert.sameValue(first.done, false); assert.sameValue(first.value, n);
    log.push(`yield:${first.value}:${state}`);
    const last = sequence.next();
    assert.sameValue(last.done, true);
    returned = last.value; log.push(`return:${returned}:${state}`);
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `route:${n}`);
    log.push(`catch:${error.message}:${state}`);
  } finally { state += 100; log.push(`caller-finally:${state}`); }
  assert.sameValue(returned, n < 0 ? undefined : (n + 1) * 2);
  assert.sameValue(state, n + 131);
  const completion = n < 0 ? `catch:route:${n}:${n + 31}` : `return:${(n + 1) * 2}:${n + 31}`;
  assert.compareArray(log, [`enter:${n}:0`, `yield:${n}:${n}`, `resume:${n + 1}`, `callee-finally:${n + 11}`,
    `delegate-finally:${n + 31}`, completion, `caller-finally:${n + 131}`]);
}
