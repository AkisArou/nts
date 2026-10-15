// `===` between values of different `typeof` kinds is `false`, and `!==` is
// `true`, whatever the two are. Unchecked JavaScript writes such pairs, as
// test262 does (a bigint against a symbol, `bigint-and-incomparable-primitive`),
// and neither side was erased: a `number` against a `boolean` was HIR the
// verifier refused, and a bigint against a symbol HIR it accepted, which C
// answered by luck and the JVM could not load. `sameKinds` is the control: the
// same comparisons between values of one kind, which compiled before.
//
// Each answer is a bit of a number, so every comparison is checked and none
// rides on an array method of a non-numeric array, which C refuses.

/** @param {number} n @returns {number} */
export function acrossKinds(n) {
  const one = (n & 0) + 1;
  const yes = n === n;
  const big = BigInt(n & 7);
  const sym = Symbol("s");
  const text = String(n & 1);
  let bits = 0;
  if (one === yes) bits |= 1;
  if (one !== yes) bits |= 2;
  if (big === sym) bits |= 4;
  if (big !== sym) bits |= 8;
  if (0n === Symbol("1")) bits |= 16;
  if (0n !== sym) bits |= 32;
  if (one === text) bits |= 64;
  if (yes === text) bits |= 128;
  return bits;
}

/** @param {number} n @returns {number} */
export function sameKinds(n) {
  const one = (n & 0) + 1;
  const two = (n & 0) + 2;
  const yes = n === n;
  const no = n !== n;
  let bits = 0;
  if (one === two) bits |= 1;
  if (one !== two) bits |= 2;
  if (yes === no) bits |= 4;
  if (yes !== no) bits |= 8;
  return bits;
}
