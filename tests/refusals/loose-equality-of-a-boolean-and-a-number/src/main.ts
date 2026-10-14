// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with
//
// `true == 1`: JavaScript's `==` converts the boolean to a number first
// (IsLooselyEqual). Until 093733f2d this was invalid HIR (MixedOperands
// Bool/Float) and an outcomes record; `==` now refuses representations that
// do not agree. 34 test262 language files at e32be23f8. The control,
// outcomes/loose-equality-after-an-explicit-conversion, converts first.
// @ts-expect-error -- a boolean and a number are loosely equal in JavaScript
if ((true == 1) !== true) throw new Error("true == 1");
