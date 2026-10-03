// **A BigInt compared with a string converts the string as a Number.** The
// relational operators between a BigInt and a String apply StringToBigInt to
// the string (ECMA-262 IsLessThan, step 3-4): an incomparable string yields
// `undefined` and the comparison is `false`, and a comparable one is compared
// *exactly*. nts converts the string with Number semantics instead, so:
//
//   1n > "0."                              node false   nts true    ("0." is 0 as a Number)
//   9007199254740993n > "9007199254740992" node true    nts false   (both 2^53 as doubles)
//
// Found by the test262 census of caf82c58d: closed-call specialization
// (9533b3a5e) recovered the string argument, and six files that were refused
// before now answer wrongly -- {less-than,greater-than,less-than-or-equal,
// greater-than-or-equal}/bigint-and-incomparable-string.js and
// {greater-than,less-than-or-equal}/bigint-and-string.js. The defect stood behind
// the refusal; it was not introduced.
//
// **Controls, one difference each:** a comparable string with no fraction
// (`1n > "0"`, where Number and StringToBigInt agree) and the precision case
// with both sides BigInt (`9007199254740993n > 9007199254740992n`). Both agree.

function gt(a: bigint, b: string): boolean {
  // @ts-expect-error -- JavaScript: a BigInt and a String compare by StringToBigInt
  return a > b;
}

observe("1n > \"0.\" (incomparable)", String(gt(1n, "0.")));
observe("2^53+1 > \"2^53\" (precision)", String(gt(9007199254740993n, "9007199254740992")));
observe("1n > \"0\" (control: comparable)", String(gt(1n, "0")));
observe("2^53+1 > 2^53 as BigInts (control)", String(9007199254740993n > 9007199254740992n));
done();
