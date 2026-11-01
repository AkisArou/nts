/*---
description: Bigint fields preserve successful powers and throw RangeError for negative exponents.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-errors, ts-arrow-functions, ts-functions, ts-objects]
---*/
// Bigint base/exponent fields meet at **; node rejects negative exponents and retains zero, odd and even powers.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [-3n, -1n, 0n, 1n, 2n, 3n];
const operand: { value: bigint; other: bigint } = { value: 0n, other: 0n };
const expectedPower: bigint[] = [1n, 0n, 0n, 0n, 1n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, -1n, 1n, -1n, 1n, 2n, 4n, 8n, 1n, -2n, 4n, -8n, 1n, 3n, 9n, 27n, 1n, -3n, 9n, -27n, 1n, 7n, 49n, 343n, 1n, -7n, 49n, -343n, 1n, 9223372036854775807n, 85070591730234615847396907784232501249n, 784637716923335095224261902710254454442933591094742482943n, 1n, -9223372036854775808n, 85070591730234615865843651857942052864n, -784637716923335095479473677900958302012794430558004314112n, 1n, 18446744073709551616n, 340282366920938463463374607431768211456n, 6277101735386680763835789423207666416102355444464034512896n, 1n, 170141183460469231731687303715884105727n, 28948022309329048855892746252171976962977213799489202546401021394546514198529n, 4925250774549309901534880012517951725548123341880193686925858436774199290547709261477934266526216329006041303875583n, 1n, -170141183460469231731687303715884105728n, 28948022309329048855892746252171976963317496166410141009864396001978282409984n, -4925250774549309901534880012517951725634967408808180833493536675530715221437151326426783281860614455100828498788352n, 1n, 9007199254740993n, 81129638414606699710187514626049n, 730750818665451702490757660178213618792745926657n];
let checked = 0, rejected = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  operand.value = a; operand.other = b;
  if (j < 2) {
    assert.throws(RangeError, () => { const result: bigint = operand.value ** operand.other; assert.sameValue(typeof result, "bigint"); }); rejected++;
  } else {
    const power: bigint = operand.value ** operand.other;
    assert.sameValue(power, expectedPower[checked]); assert.sameValue(typeof power, "bigint");
    checked++;
  }
}
assert.sameValue(checked, 64); assert.sameValue(rejected, 32);
