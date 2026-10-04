// Order is the public ICU relative-unit ABI, independent of public key order.
const units: readonly Intl.RelativeTimeFormatUnitSingular[] = [
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
];

export function relativeUnit(unit: string): number {
  for (let index = 0; index < units.length; index++) {
    const candidate = units[index]!;
    if (unit === candidate || unit === candidate + "s") return index;
  }
  throw new RangeError("Invalid relative time unit");
}

export function relativeUnitName(unit: number): Intl.RelativeTimeFormatUnitSingular {
  return units[unit]!;
}

export function relativeAuto(value: number, numeric: Intl.RelativeTimeFormatNumeric): boolean {
  // ICU tolerates approximately integer offsets in its text API. ECMA-402
  // looks up the exact String(value) key instead, including -0 as "0".
  return numeric === "auto" && Number.isInteger(value);
}
