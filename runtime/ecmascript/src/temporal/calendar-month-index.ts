// Exact month coordinates for fixed-month calendars and the Hebrew cycle.
// Chinese/Korean coordinates belong to their validated lunisolar topology.
export function calendarMonthIndex(identifier: string, year: number, month: number): number {
  if (identifier === "chinese" || identifier === "dangi") return NaN;
  if (identifier === "hebrew") return Math.floor((235 * year - 234) / 19) + month;
  const count =
    identifier === "coptic" || identifier === "ethiopic" || identifier === "ethioaa" ? 13 : 12;
  return year * count + month;
}

export function calendarYearFromMonthIndex(identifier: string, index: number): number {
  if (identifier === "chinese" || identifier === "dangi") return NaN;
  if (identifier === "hebrew") {
    let year = Math.floor((19 * index + 234) / 235);
    while (Math.floor((235 * year - 234) / 19) > index) year--;
    while (Math.floor((235 * (year + 1) - 234) / 19) <= index) year++;
    return year;
  }
  const count =
    identifier === "coptic" || identifier === "ethiopic" || identifier === "ethioaa" ? 13 : 12;
  return Math.floor(index / count);
}
