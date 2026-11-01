/*---
description: Bigint parameters preserve exact multiplication by positive and negative factors.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-functions]
---*/
// Bigint parameters carry signed edge operands into multiplication; node retains every product bit and sign.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [2n, -3n];
function productRoute(a: bigint, b: bigint): bigint { return a * b; }
const expectedProduct: bigint[] = [0n, 0n, 0n, 0n, 2n, -3n, -2n, 3n, 4n, -6n, -4n, 6n, 6n, -9n, -6n, 9n, 14n, -21n, -14n, 21n, 18446744073709551614n, -27670116110564327421n, -18446744073709551616n, 27670116110564327424n, 36893488147419103232n, -55340232221128654848n, 340282366920938463463374607431768211454n, -510423550381407695195061911147652317181n, -340282366920938463463374607431768211456n, 510423550381407695195061911147652317184n, 18014398509481986n, -27021597764222979n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  const product: bigint = productRoute(a, b);
  assert.sameValue(product, expectedProduct[checked]); assert.sameValue(typeof product, "bigint");
  checked++;
}
assert.sameValue(checked, 32);
