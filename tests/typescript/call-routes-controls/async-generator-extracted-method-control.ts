/*---
description: Control for async-generator-extracted-method; the call uses the declared target directly.
features: [ts-call-route-suspension, ts-async, ts-async-generators, ts-generators, ts-function-types, ts-errors, ts-unknown, ts-class, ts-this-parameter, ts-this]
flags: [async]
---*/
// Control: paired with ../call-routes/async-generator-extracted-method.ts; the direct call receives source as this.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
class Source {
  async *produce(this: unknown, n: number): AsyncGenerator<number, number, void> {
    receivers.push(this); log.push(`enter:${n}:${state}`);
    try {
      state = n;
      yield n;
      await Promise.resolve();
      state += 1; log.push(`resume:${state}`);
      if (n < 0) throw new RangeError(`route:${n}`);
      return state * 2;
    } finally { state += 10; log.push(`callee-finally:${state}`); }
  }
}
const source = new Source();
const target: (n: number) => AsyncGenerator<number, number, void> = source.produce;
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    state = 0; log.length = 0; receivers.length = 0;
    let returned: number | undefined;
    try {
      const sequence = source.produce(n);
      const first = await sequence.next();
      assert.compareArray([first.done, first.value], [false, n]);
      log.push(`yield:${first.value}:${state}`);
      const last = await sequence.next();
      assert.sameValue(last.done, true);
      returned = last.value; log.push(`return:${returned}:${state}`);
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      assert.sameValue(error.message, `route:${n}`);
      log.push(`catch:${error.message}:${state}`);
    } finally { state += 100; log.push(`caller-finally:${state}`); }
    assert.sameValue(returned, n < 0 ? undefined : (n + 1) * 2);
    assert.sameValue(state, n + 111);
    assert.compareArray(receivers, [source]);
    const completion = n < 0 ? `catch:route:${n}:${n + 11}` : `return:${(n + 1) * 2}:${n + 11}`;
    assert.compareArray(log, [`enter:${n}:0`, `yield:${n}:${n}`, `resume:${n + 1}`,
      `callee-finally:${n + 11}`, completion, `caller-finally:${n + 111}`]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
