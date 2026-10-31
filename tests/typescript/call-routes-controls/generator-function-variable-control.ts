/*---
description: Control for generator-function-variable; the call uses the declared target directly.
features: [ts-call-route-suspension, ts-generators, ts-functions, ts-function-types, ts-errors, ts-unknown]
---*/
// Control: paired with ../call-routes/generator-function-variable.ts; only the call route changes.
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
const target: (n: number) => Generator<number, number, void> = produce;
for (const n of [-2, 0, 3]) {
  state = 0; log.length = 0;
  let returned: number | undefined;
  try {
    const sequence = produce(n);
    const first = sequence.next();
    assert.sameValue(first.done, false);
    assert.sameValue(first.value, n);
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
  assert.sameValue(state, n + 111);
  const completion = n < 0 ? `catch:route:${n}:${n + 11}` : `return:${(n + 1) * 2}:${n + 11}`;
  assert.compareArray(log, [`enter:${n}:0`, `yield:${n}:${n}`, `resume:${n + 1}`,
    `callee-finally:${n + 11}`, completion, `caller-finally:${n + 111}`]);
}
