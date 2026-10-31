/*---
description: A typed registry calls 64 distinct callbacks of different shapes, including one async-generator.
features: [ts-call-route-population, ts-functions, ts-function-types, ts-arrays, ts-optional-parameters, ts-default-parameters, ts-rest-parameters, ts-errors, ts-unknown, ts-async, ts-async-generators, ts-generators, ts-unions, ts-spread]
flags: [async]
---*/
// Route: 64 independent targets share a typed array; node checks every target before and after slot 32.
type Rest = (number | undefined)[];
type Callback = ((n: number, b?: number) => number) | ((n: number, b?: number) => AsyncGenerator<number, number, void>);
const throwing = true;
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
  const value = see(32, n, b); yield value; return value;
}
const callbacks: Callback[] = [
  n => see(0, n, 0), (n, b?: number) => see(1, n, b ?? 0), (n, b = 5) => see(2, n, b), (n, ...r: Rest) => see(3, n, r[0] ?? 0),
  n => see(4, n, 0), (n, b?: number) => see(5, n, b ?? 0), (n, b = 5) => see(6, n, b), (n, ...r: Rest) => see(7, n, r[0] ?? 0),
  n => see(8, n, 0), (n, b?: number) => see(9, n, b ?? 0), (n, b = 5) => see(10, n, b), (n, ...r: Rest) => see(11, n, r[0] ?? 0),
  n => see(12, n, 0), (n, b?: number) => see(13, n, b ?? 0), (n, b = 5) => see(14, n, b), (n, ...r: Rest) => see(15, n, r[0] ?? 0),
  n => see(16, n, 0), (n, b?: number) => see(17, n, b ?? 0), (n, b = 5) => see(18, n, b), (n, ...r: Rest) => see(19, n, r[0] ?? 0),
  n => see(20, n, 0), (n, b?: number) => see(21, n, b ?? 0), (n, b = 5) => see(22, n, b), (n, ...r: Rest) => see(23, n, r[0] ?? 0),
  n => see(24, n, 0), (n, b?: number) => see(25, n, b ?? 0), (n, b = 5) => see(26, n, b), (n, ...r: Rest) => see(27, n, r[0] ?? 0),
  n => see(28, n, 0), (n, b?: number) => see(29, n, b ?? 0), (n, b = 5) => see(30, n, b), (n, ...r: Rest) => see(31, n, r[0] ?? 0),
  special, (n, b?: number) => see(33, n, b ?? 0), (n, b = 5) => see(34, n, b), (n, ...r: Rest) => see(35, n, r[0] ?? 0),
  n => see(36, n, 0), (n, b?: number) => see(37, n, b ?? 0), (n, b = 5) => see(38, n, b), (n, ...r: Rest) => see(39, n, r[0] ?? 0),
  n => see(40, n, 0), (n, b?: number) => see(41, n, b ?? 0), (n, b = 5) => see(42, n, b), (n, ...r: Rest) => see(43, n, r[0] ?? 0),
  n => see(44, n, 0), (n, b?: number) => see(45, n, b ?? 0), (n, b = 5) => see(46, n, b), (n, ...r: Rest) => see(47, n, r[0] ?? 0),
  n => see(48, n, 0), (n, b?: number) => see(49, n, b ?? 0), (n, b = 5) => see(50, n, b), (n, ...r: Rest) => see(51, n, r[0] ?? 0),
  n => see(52, n, 0), (n, b?: number) => see(53, n, b ?? 0), (n, b = 5) => see(54, n, b), (n, ...r: Rest) => see(55, n, r[0] ?? 0),
  n => see(56, n, 0), (n, b?: number) => see(57, n, b ?? 0), (n, b = 5) => see(58, n, b), (n, ...r: Rest) => see(59, n, r[0] ?? 0),
  n => see(60, n, 0), (n, b?: number) => see(61, n, b ?? 0), (n, b = 5) => see(62, n, b), (n, ...r: Rest) => see(63, n, r[0] ?? 0),
];
async function main(): Promise<void> {
  assert.sameValue(callbacks.length, 64);
  for (const n of [-3, -1, 0, 2]) {
    const supplied = n === 0 ? undefined : 7, fails = throwing && n < 0;
    for (let slot = 0; slot < callbacks.length; slot++) {
      state = 0; log.length = 0;
      const b = slot === 32 ? supplied ?? 5 : slot % 4 === 0 ? 0 : supplied ?? (slot % 4 === 2 ? 5 : 0);
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
        ...(slot === 32 && !fails ? [`yield:${value}:${value + 1}`] : []),
        fails ? `catch:slot:${slot}:${n}:${value + 1}` : `return:${value}:${value + 1}`, `caller-finally:${value + 101}`]);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
