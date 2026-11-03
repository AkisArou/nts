// Each entry observes parseInt on a radix boundary against the Node oracle.
// The control changes only explicit radix conversion: implicit ToInt32 becomes | 0.
export function nan(): number { return parseInt("0x10", (NaN) | 0); }
export function positiveInfinity(): number { return parseInt("0x10", (Infinity) | 0); }
export function negativeInfinity(): number { return parseInt("0x10", (-Infinity) | 0); }
export function positiveZero(): number { return parseInt("0x10", (0) | 0); }
export function negativeZero(): number { return parseInt("0x10", (-0) | 0); }
export function fractionToDefault(): number { return parseInt("0x10", (0.9) | 0); }
export function negativeFractionToDefault(): number { return parseInt("0x10", (-0.9) | 0); }
export function radixOne(): number { return parseInt("0x10", (1) | 0); }
export function negativeRadix(): number { return parseInt("0x10", (-1) | 0); }
export function radixTooLarge(): number { return parseInt("0x10", (37) | 0); }
export function fractionalTwo(): number { return parseInt("0x10", (2.9) | 0); }
export function fractionalTen(): number { return parseInt("0x10", (10.9) | 0); }
export function fractionalSixteen(): number { return parseInt("0x10", (16.9) | 0); }
export function positiveWrap(): number { return parseInt("0x10", (4294967296) | 0); }
export function positiveWrapTwo(): number { return parseInt("0x10", (4294967298) | 0); }
export function positiveWrapSixteen(): number { return parseInt("0x10", (4294967312) | 0); }
export function wrapToInvalid(): number { return parseInt("0x10", (4294967333) | 0); }
export function negativeWrap(): number { return parseInt("0x10", (-4294967296) | 0); }
export function negativeWrapTwo(): number { return parseInt("0x10", (-4294967294) | 0); }
export function negativeWrapSixteen(): number { return parseInt("0x10", (-4294967280) | 0); }
export function signedMaximum(): number { return parseInt("0x10", (2147483647) | 0); }
export function signedMinimum(): number { return parseInt("0x10", (-2147483648) | 0); }
export function unsignedMaximum(): number { return parseInt("0x10", (4294967295) | 0); }
export function negativeUnsignedMaximum(): number { return parseInt("0x10", (-4294967295) | 0); }
export function largeInteger(): number { return parseInt("0x10", (9007199254740992) | 0); }
export function largestNumber(): number { return parseInt("0x10", (Number.MAX_VALUE) | 0); }
export function negativeLargestNumber(): number { return parseInt("0x10", (-Number.MAX_VALUE) | 0); }
export function fractionalNegativeWrap(): number { return parseInt("0x10", (-4294967280.75) | 0); }

// Omission, explicit undefined and NaN take the same inferred-radix path.
export function omitted(): number { return parseInt("0x10"); }
export function explicitUndefined(): number { return parseInt("0x10", undefined); }
export function decimalLiteral(): number { return parseInt("12345tail", 10); }
