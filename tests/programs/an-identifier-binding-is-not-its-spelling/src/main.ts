// The same spelling as an intrinsic binding is still a string or a property.
// Each pair changes only the string "undefined" to the value undefined.

export function typeofWord(n: number): string {
  return typeof "undefined" + n;
}

export function typeofValue(n: number): string {
  return typeof undefined + n;
}

export function typeofWordCompared(n: number): number {
  return (typeof "undefined" === "undefined" ? 1 : 0) + n;
}

export function typeofValueCompared(n: number): number {
  return (typeof undefined === "undefined" ? 1 : 0) + n;
}

function equalToAbsence(value: unknown): number {
  return value === undefined ? 1 : 0;
}

export function equalityWord(n: number): number {
  return equalToAbsence("undefined") + n;
}

export function equalityValue(n: number): number {
  return equalToAbsence(undefined) + n;
}

export function concatenationWord(n: number): string {
  return "undefined" + "" + n;
}

export function concatenationValue(n: number): string {
  return undefined + "" + n;
}

function condition(value: string | undefined): number {
  return value ? 1 : 0;
}

export function conditionWord(n: number): number {
  return condition("undefined") + n;
}

export function conditionValue(n: number): number {
  return condition(undefined) + n;
}

export function aLocalNaNIsTheLocal(n: number): number {
  const NaN = 1;
  return NaN + n;
}

export function aLocalInfinityIsTheLocal(n: number): number {
  const Infinity = 3;
  return Infinity + n;
}

export function propertyNamesAreTheirProperties(n: number): number {
  const value = { undefined: 2, NaN: 3, Infinity: 5, arguments: 7, globalThis: 11 };
  return value.undefined + value.NaN + value.Infinity + value.arguments + value.globalThis + n;
}
