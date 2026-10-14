// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with
//
// `1n == 1` is true in JavaScript (a bigint and a number compared by
// mathematical value). Until 093733f2d this was invalid HIR (MixedOperands
// BigInt/Float) and an outcomes record; it refuses now. 12 test262 language
// files at e32be23f8. The control, outcomes/
// loose-equality-after-an-explicit-conversion, writes `BigInt(1)`.
// @ts-expect-error -- a bigint and a number are loosely equal in JavaScript
if ((1n == 1) !== true) throw new Error("1n == 1");
