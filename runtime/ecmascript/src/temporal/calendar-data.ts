// Calendar data, not ECMAScript field preparation or arithmetic. One reusable
// cursor belongs to the environment; immutable values copy only their scalars.
// field: arithmetic year, zero-based ordinal month, day, day of year,
// days in month, days in year, months in year, leap year.
export interface CalendarPrimitive {
  // A failed load exposes the provider range without constructing a JS error.
  load(epochDay: number): boolean;
  field(index: number): number;
  monthCode(): string | undefined;
  // Conversion is an estimate outside the provider's defined calendar-data
  // range. Shared year/month topology must validate it against loaded fields.
  // A provider conversion may move the cursor; finish reads before converting.
  estimateEpochDay(year: number, ordinalMonth: number, day: number): number;
  // Serial month coordinates support bounded large additions/differences.
  // A raw astronomical provider may decline with NaN; its shared data strategy
  // supplies the full-range coordinates before public arithmetic uses it.
  monthIndex(year: number, ordinalMonth: number): number;
  yearFromMonthIndex(index: number): number;
}
