function maybe(n: number): string | undefined {
  return n > 0 ? "text" : undefined;
}
function orNull(n: number): string | null {
  return n > 0 ? "text" : null;
}
function describe(value: unknown): number {
  return value === undefined ? 1 : value === null ? 2 : typeof value === "string" ? 11 : 99;
}
function erasedMaybe(n: number): unknown {
  return maybe(n);
}
function erasedNull(n: number): unknown {
  return orNull(n);
}
export function directUndefined(n: number): number {
  return describe(maybe(n));
}
export function directNull(n: number): number {
  return describe(orNull(n));
}
export function mixed(n: number): number {
  return describe(maybe(n)) * 100 + describe(orNull(n));
}
export function returnedUndefined(n: number): number {
  const value = erasedMaybe(n);
  return value === undefined ? 1 : typeof value === "string" ? 11 : 99;
}
export function returnedNull(n: number): number {
  const value = erasedNull(n);
  return value === null ? 2 : typeof value === "string" ? 11 : 99;
}
export function arrayUndefined(n: number): number {
  const values: unknown[] = [maybe(n)];
  return values[0] === undefined ? 1 : typeof values[0] === "string" ? 11 : 99;
}
export function arrayNull(n: number): number {
  const values: unknown[] = [orNull(n)];
  return values[0] === null ? 2 : typeof values[0] === "string" ? 11 : 99;
}
function describeKnown(value: unknown): number {
  return typeof value === "string" ? 11 : 99;
}
export function nonnullableControl(n: number): number {
  return describeKnown(n > 0 ? "first" : "second");
}
