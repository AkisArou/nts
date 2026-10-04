// ECMA-402's sanctioned simple units, in code-unit order. ICU's larger unit
// registry must not widen either NumberFormat validation or supportedValuesOf.
const units: readonly string[] = [
  "acre",
  "bit",
  "byte",
  "celsius",
  "centimeter",
  "day",
  "degree",
  "fahrenheit",
  "fluid-ounce",
  "foot",
  "gallon",
  "gigabit",
  "gigabyte",
  "gram",
  "hectare",
  "hour",
  "inch",
  "kilobit",
  "kilobyte",
  "kilogram",
  "kilometer",
  "liter",
  "megabit",
  "megabyte",
  "meter",
  "microsecond",
  "mile",
  "mile-scandinavian",
  "milliliter",
  "millimeter",
  "millisecond",
  "minute",
  "month",
  "nanosecond",
  "ounce",
  "percent",
  "petabyte",
  "pound",
  "second",
  "stone",
  "terabit",
  "terabyte",
  "week",
  "yard",
  "year",
];

export function supportedUnits(): string[] {
  return units.slice();
}

export function validUnit(unit: string): boolean {
  if (units.includes(unit)) return true;
  const per = unit.indexOf("-per-");
  return per >= 0 && units.includes(unit.slice(0, per)) && units.includes(unit.slice(per + 5));
}
