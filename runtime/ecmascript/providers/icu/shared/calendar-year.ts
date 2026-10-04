// Translate the pinned ICU extended-year coordinate at the provider boundary.
// Both adapters use this one mapping; the shared Temporal core sees arithmetic
// years and has no knowledge of ICU's calendar epochs or internal APIs.
export function icuCalendarYear(calendar: string, extendedYear: number): number {
  switch (calendar) {
    case "buddhist":
      return extendedYear + 543;
    case "roc":
      return extendedYear - 1911;
    default:
      return extendedYear;
  }
}
export function icuExtendedYear(calendar: string, year: number): number {
  switch (calendar) {
    case "buddhist":
      return year - 543;
    case "roc":
      return year + 1911;
    default:
      return year;
  }
}
