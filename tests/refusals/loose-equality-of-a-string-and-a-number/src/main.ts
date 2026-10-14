// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with
//
// `"1" == 1`: JavaScript's `==` converts before comparing (IsLooselyEqual).
// Until 093733f2d this emitted C that did not compile (`nts_string_eq` given a
// double) and was an outcomes record; `==` now asks whether its two
// representations agree and refuses when they do not. Siblings: a boolean and
// a number, a bigint and a number. The control, outcomes/
// loose-equality-after-an-explicit-conversion, writes the conversion out.
// @ts-expect-error -- a string and a number are loosely equal in JavaScript
if (("1" == 1) !== true) throw new Error("\"1\" == 1");
