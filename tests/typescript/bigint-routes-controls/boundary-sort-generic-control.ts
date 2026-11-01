/*---
description: Control for boundary-sort-generic; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-conversions, ts-numbers]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expected: bigint[] = [-170141183460469231731687303715884105728n, -9223372036854775808n, -7n, -3n, -2n, -1n, 0n, 0n, 1n, 2n, 3n, 7n, 9007199254740993n, 9223372036854775807n, 18446744073709551616n, 170141183460469231731687303715884105727n];
const expectedSigns: number[] = [0, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 0, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 0, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 0, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, -1, -1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1, 1, 0];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const left: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const right: bigint = j === 0 ? 0n : j === 1 ? -0n : j === 2 ? 1n : j === 3 ? -1n : j === 4 ? 2n : j === 5 ? -2n : j === 6 ? 3n : j === 7 ? -3n : j === 8 ? 7n : j === 9 ? -7n : j === 10 ? 9223372036854775807n : j === 11 ? -9223372036854775808n : j === 12 ? 18446744073709551616n : j === 13 ? 170141183460469231731687303715884105727n : j === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const sign: bigint = left < right ? -1n : left > right ? 1n : 0n; const result: number = Number(sign);
  assert.sameValue(result, expectedSigns[checked++]); assert.sameValue(typeof result, "number");
}
for (const start of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const source: number[] = []; for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) source.push((start + at) % 16);
  const result = source;
  for (let at = 1; at < result.length; at++) {
    const held: number = result[at]; let cursor = at;
    while (cursor > 0) {
      const earlier: number = result[cursor - 1];
      const left: bigint = earlier === 0 ? 0n : earlier === 1 ? -0n : earlier === 2 ? 1n : earlier === 3 ? -1n : earlier === 4 ? 2n : earlier === 5 ? -2n : earlier === 6 ? 3n : earlier === 7 ? -3n : earlier === 8 ? 7n : earlier === 9 ? -7n : earlier === 10 ? 9223372036854775807n : earlier === 11 ? -9223372036854775808n : earlier === 12 ? 18446744073709551616n : earlier === 13 ? 170141183460469231731687303715884105727n : earlier === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
      const right: bigint = held === 0 ? 0n : held === 1 ? -0n : held === 2 ? 1n : held === 3 ? -1n : held === 4 ? 2n : held === 5 ? -2n : held === 6 ? 3n : held === 7 ? -3n : held === 8 ? 7n : held === 9 ? -7n : held === 10 ? 9223372036854775807n : held === 11 ? -9223372036854775808n : held === 12 ? 18446744073709551616n : held === 13 ? 170141183460469231731687303715884105727n : held === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
      const sign: bigint = left < right ? -1n : left > right ? 1n : 0n; const comparison: number = Number(sign);
      if (comparison <= 0) break; result[cursor] = earlier; cursor--;
    }
    result[cursor] = held;
  }
  assert.sameValue(result, source); assert.sameValue(result.length, 16);
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    const at: number = result[i]; const value: bigint = at === 0 ? 0n : at === 1 ? -0n : at === 2 ? 1n : at === 3 ? -1n : at === 4 ? 2n : at === 5 ? -2n : at === 6 ? 3n : at === 7 ? -3n : at === 8 ? 7n : at === 9 ? -7n : at === 10 ? 9223372036854775807n : at === 11 ? -9223372036854775808n : at === 12 ? 18446744073709551616n : at === 13 ? 170141183460469231731687303715884105727n : at === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
    assert.sameValue(value, expected[i]); assert.sameValue(typeof value, "bigint");
  }
}
assert.sameValue(checked, 256);
