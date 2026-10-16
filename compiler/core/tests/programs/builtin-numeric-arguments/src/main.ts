export function erasedFast(value: any): number { return Math.abs(value); }
export function numericRoundTrip(value: number): number {
  const erased: any = value;
  return Math.abs(erased);
}
export function nativeNumber(value: number): number { return Math.abs(value); }

export function fixedThree(value: number): string { return value.toFixed(3); }
export function fixedNegativeFraction(value: number): string { return value.toFixed(-0.9); }
export function fixedPositiveFraction(value: number): string { return value.toFixed(100.9); }
export function fixedZero(value: number): string { return value.toFixed(0); }
export function fixedNegativeZero(value: number): string { return value.toFixed(-0); }
export function fixedNan(value: number): string { return value.toFixed(NaN); }
export function fixedInfinity(value: number): string { return value.toFixed(Infinity); }
export function fixedNegativeInfinity(value: number): string { return value.toFixed(-Infinity); }
export function fixedDynamic(value: number, digits: number): string { return value.toFixed(digits); }
