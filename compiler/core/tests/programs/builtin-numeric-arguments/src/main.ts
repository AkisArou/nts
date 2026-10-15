export function erasedFast(value: any): number { return Math.abs(value); }
export function numericRoundTrip(value: number): number {
  const erased: any = value;
  return Math.abs(erased);
}
export function nativeNumber(value: number): number { return Math.abs(value); }
