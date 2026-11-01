/*---
description: Control for boundary-includes-parameter; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expected = "TTTFFFFFFFFFFFFFTTTFFFFFFFFFFFFFFFTFTFFFFFFFFFFFTTFTFFFFFFFFFFFFFFFFTFTFFFFFFFFFFFFTFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFTFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFT";
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const query: bigint = j === 0 ? 0n : j === 1 ? -0n : j === 2 ? 1n : j === 3 ? -1n : j === 4 ? 2n : j === 5 ? -2n : j === 6 ? 3n : j === 7 ? -3n : j === 8 ? 7n : j === 9 ? -7n : j === 10 ? 9223372036854775807n : j === 11 ? -9223372036854775808n : j === 12 ? 18446744073709551616n : j === 13 ? 170141183460469231731687303715884105727n : j === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  let result = false;
  for (const slot of [0, 1, 2]) {
    const candidate: bigint = slot === 1 ? (i === 0 ? 1n : i === 1 ? 1n : i === 2 ? 2n : i === 3 ? 0n : i === 4 ? 3n : i === 5 ? -1n : i === 6 ? 4n : i === 7 ? -2n : i === 8 ? 8n : i === 9 ? -6n : i === 10 ? 9223372036854775808n : i === 11 ? -9223372036854775807n : i === 12 ? 18446744073709551617n : i === 13 ? 170141183460469231731687303715884105728n : i === 14 ? -170141183460469231731687303715884105727n : 9007199254740994n) : (i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n);
    if (candidate === query) { result = true; break; }
  }
  assert.sameValue(result, expected[checked++] === "T"); assert.sameValue(typeof result, "boolean");
}
assert.sameValue(checked, 256);
