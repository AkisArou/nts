/*---
description: Numeric enum members widened into a number field retain boundary values and fractional quotients.
features: [ts-number-route-types, ts-numbers, ts-enum, ts-class, ts-class-fields]
---*/
// Route: numeric enum members widen into a declared number field; node gives the fixed values, signs and text below.
enum NumberRouteEnum { Zero = 0, Small = 3, Negative = -3, Int32Last = 2147483647, Int32Next = 2147483648, Uint32Next = 4294967296, SafeNext = 9007199254740992, SafeStep = 9007199254740994, Fraction = 1.25 }
class EnumNumberField { value: number = 0; }
const numberSamples = [
  { a: NumberRouteEnum.Zero, b: 2, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: NumberRouteEnum.Small, b: 2, expected: 1.5, text: "1.5", inverse: 0.6666666666666666, inverseText: "0.6666666666666666" },
  { a: NumberRouteEnum.Negative, b: 2, expected: -1.5, text: "-1.5", inverse: -0.6666666666666666, inverseText: "-0.6666666666666666" },
  { a: NumberRouteEnum.Int32Last, b: 2, expected: 1073741823.5, text: "1073741823.5", inverse: 9.313225750491594e-10, inverseText: "9.313225750491594e-10" },
  { a: NumberRouteEnum.Int32Next, b: 2, expected: 1073741824, text: "1073741824", inverse: 9.313225746154785e-10, inverseText: "9.313225746154785e-10" },
  { a: NumberRouteEnum.Uint32Next, b: 2, expected: 2147483648, text: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10" },
  { a: NumberRouteEnum.SafeNext, b: 2, expected: 4503599627370496, text: "4503599627370496", inverse: 2.220446049250313e-16, inverseText: "2.220446049250313e-16" },
  { a: NumberRouteEnum.SafeStep, b: 2, expected: 4503599627370497, text: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16" },
  { a: NumberRouteEnum.Fraction, b: 2, expected: 0.625, text: "0.625", inverse: 1.6, inverseText: "1.6" },
];
for (const row of numberSamples) {
  const holder = new EnumNumberField(); holder.value = row.a; const actual: number = holder.value / 2;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
