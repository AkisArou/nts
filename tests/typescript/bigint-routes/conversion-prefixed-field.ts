/*---
description: Parsed hexadecimal, octal and binary text preserves exact bigint values through an interface field, including whitespace and wide values.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-interfaces, ts-objects, ts-arrays]
---*/
// Route: prefixed integer text is converted into a bigint field and read back; node retains the exact value across every base and width.
interface ParsedBigint { value: bigint; }
const parsed: ParsedBigint = { value: 0n };
const inputs: string[] = ["0x0"," 0X1 ","\t0xff\n","0x7fffffffffffffff","0x8000000000000000"," 0x10000000000000000 ","0x7fffffffffffffffffffffffffffffff","0x80000000000000000000000000000000","0o0","\n0O7 ","0o1777777777777777777777","0o2000000000000000000000","0b0"," 0B101 ","0b111111111111111111111111111111111111111111111111111111111111111","\t0b10000000000000000000000000000000000000000000000000000000000000000\n"];
const expected: bigint[] = [0n, 1n, 255n, 9223372036854775807n, 9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, 0n, 7n, 18446744073709551615n, 18446744073709551616n, 0n, 5n, 9223372036854775807n, 18446744073709551616n];
for (let index = 0; index < 16; index++) {
  const source: string = inputs[index];
  parsed.value = BigInt(source);
  const result: bigint = parsed.value;
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
}
