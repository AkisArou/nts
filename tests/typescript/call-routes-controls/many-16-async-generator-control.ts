/*---
description: Control for many-16-async-generator; every callback runs without throwing.
features: [ts-call-route-population, ts-functions, ts-function-types, ts-arrays, ts-optional-parameters, ts-default-parameters, ts-rest-parameters, ts-errors, ts-unknown, ts-async, ts-async-generators, ts-generators, ts-unions, ts-spread]
flags: [async]
---*/
// Control: paired with ../call-routes/many-16-async-generator.ts; only throwing changes to false, retaining the whole registry.
type Rest = (number | undefined)[];
type Callback = ((n: number, b?: number) => number) | ((n: number, b?: number) => AsyncGenerator<number, number, void>);
const throwing = false;
const log: string[] = [];
let state = 0;
function see(slot: number, n: number, b: number): number {
  state = 100 * slot + 10 * n + b; log.push(`call:${slot}:${n}:${b}:${state}`);
  try {
    if (throwing && n < 0) throw new RangeError(`slot:${slot}:${n}`);
    return state;
  } finally { state += 1; log.push(`callback-finally:${state}`); }
}
async function* special(n: number, b = 5): AsyncGenerator<number, number, void> {
  const value = see(8, n, b); yield value; return value;
}
const callbacks: Callback[] = [
  n => see(0, n, 0), (n, b?: number) => see(1, n, b ?? 0), (n, b = 5) => see(2, n, b), (n, ...r: Rest) => see(3, n, r[0] ?? 0),
  n => see(4, n, 0), (n, b?: number) => see(5, n, b ?? 0), (n, b = 5) => see(6, n, b), (n, ...r: Rest) => see(7, n, r[0] ?? 0),
  special, (n, b?: number) => see(9, n, b ?? 0), (n, b = 5) => see(10, n, b), (n, ...r: Rest) => see(11, n, r[0] ?? 0),
  n => see(12, n, 0), (n, b?: number) => see(13, n, b ?? 0), (n, b = 5) => see(14, n, b), (n, ...r: Rest) => see(15, n, r[0] ?? 0),
];
async function main(): Promise<void> {
  assert.sameValue(callbacks.length, 16);
  for (const n of [-3, -1, 0, 2]) {
    const supplied = n === 0 ? undefined : 7, fails = throwing && n < 0;
    for (let slot = 0; slot < callbacks.length; slot++) {
      state = 0; log.length = 0;
      const b = slot === 8 ? supplied ?? 5 : slot % 4 === 0 ? 0 : supplied ?? (slot % 4 === 2 ? 5 : 0);
      const value = 100 * slot + 10 * n + b;
      let returned: number | undefined;
      try {
        const result = callbacks[slot](n, supplied);
        if (typeof result === "number") returned = result;
        else {
          const first = await result.next();
          assert.sameValue(first.done, false); assert.sameValue(first.value, value);
          log.push(`yield:${first.value}:${state}`);
          const last = await result.next();
          assert.sameValue(last.done, true); returned = last.value;
        }
        log.push(`return:${returned}:${state}`);
      } catch (error: unknown) {
        if (!(error instanceof RangeError)) throw error;
        assert.sameValue(error.message, `slot:${slot}:${n}`);
        log.push(`catch:${error.message}:${state}`);
      } finally { state += 100; log.push(`caller-finally:${state}`); }
      assert.compareArray([returned, state], [fails ? undefined : value, value + 101]);
      assert.compareArray(log, [`call:${slot}:${n}:${b}:${value}`, `callback-finally:${value + 1}`,
        ...(slot === 8 && !fails ? [`yield:${value}:${value + 1}`] : []),
        fails ? `catch:slot:${slot}:${n}:${value + 1}` : `return:${value}:${value + 1}`, `caller-finally:${value + 101}`]);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
