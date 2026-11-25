// The source-local object must supply this call, even though its name and
// member match a compiler-provided intrinsic. The control removes only the
// local declaration and calls the actual global with the same arguments.
export function localMath(n: number): number {
  const Math = { max: (left: number, right: number): number => left + right };
  return Math.max(n, 3);
}

export function globalMathControl(n: number): number {
  return Math.max(n, 3);
}

export function localJSON(n: number): string {
  const JSON = { stringify: (_value: number): string => "source JSON" };
  return JSON.stringify(n);
}
export function globalJSONControl(n: number): string { return JSON.stringify(n); }
export function localNumber(n: number): boolean {
  const Number = { isNaN: (value: number): boolean => value === value };
  return Number.isNaN(n);
}
export function globalNumberControl(n: number): boolean { return Number.isNaN(n); }
export function localNumberParse(n: number): number {
  const Number = { parseInt: (_text: string): number => n + 17 };
  return Number.parseInt("3");
}
export function globalNumberParseControl(n: number): number { return Number.parseInt("3"); }
