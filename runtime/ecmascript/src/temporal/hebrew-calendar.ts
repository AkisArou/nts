import { modulo } from "../date/calendar.ts";
import { formatMonthCode } from "./calendar-month-code.ts";
import { calendarMonthIndex, calendarYearFromMonthIndex } from "./calendar-month-index.ts";

// The arithmetic Hebrew calendar uses a 19-year cycle and mean lunar months
// of 765433 parts (25920 parts per day). The postponements determine the first
// civil day of each year. These formulas also use Euclidean division for BCE.
// Algorithm reference: Reingold and Dershowitz, Calendrical Calculations,
// arithmetic Hebrew calendar. No provider calendar or host Date is involved.
const EPOCH_DAY = -2092590;
const MEAN_YEAR = 35975351 / 98496;

function elapsedDays(year: number): number {
  const months = Math.floor((235 * year - 234) / 19);
  const parts = 12084 + 13753 * months;
  const days = 29 * months + Math.floor(parts / 25920);
  return modulo(3 * (days + 1), 7) < 3 ? days + 1 : days;
}

function yearStart(year: number): number {
  const days = elapsedDays(year);
  const correction =
    elapsedDays(year + 1) - days === 356 ? 2 : days - elapsedDays(year - 1) === 382 ? 1 : 0;
  return EPOCH_DAY + days + correction;
}

function monthLength(ordinalMonth: number, daysInYear: number, leap: boolean): number {
  if (ordinalMonth === 0 || ordinalMonth === 4) return 30;
  if (ordinalMonth === 1) return daysInYear % 10 === 5 ? 30 : 29;
  if (ordinalMonth === 2) return daysInYear % 10 === 3 ? 29 : 30;
  if (ordinalMonth === 3) return 29;
  if (leap && ordinalMonth === 5) return 30;
  const commonMonth = ordinalMonth - (leap ? 1 : 0);
  return commonMonth % 2 === 0 ? 30 : 29;
}

// A reusable calendar-data cursor. Loading another day in the same year reuses
// its boundaries; neither load nor conversion allocates a per-date object.
export class HebrewCalendar {
  #year = 0;
  #start = NaN;
  #end = NaN;
  #month = 0;
  #day = 0;
  #dayOfYear = 0;
  #leap = false;

  load(epochDay: number): boolean {
    // Include the complete adjacent years needed at Temporal's end points.
    if (!Number.isInteger(epochDay) || Math.abs(epochDay) > 100000400) return false;
    if (!(epochDay >= this.#start && epochDay < this.#end)) {
      let year = Math.floor((epochDay - EPOCH_DAY) / MEAN_YEAR) + 1;
      let start = yearStart(year);
      while (start > epochDay) {
        year--;
        start = yearStart(year);
      }
      let end = yearStart(year + 1);
      while (end <= epochDay) {
        year++;
        start = end;
        end = yearStart(year + 1);
      }
      this.#year = year;
      this.#start = start;
      this.#end = end;
      this.#leap = modulo(7 * year + 1, 19) < 7;
    }
    const daysInYear = this.#end - this.#start;
    let day = epochDay - this.#start;
    this.#dayOfYear = day + 1;
    let month = 0;
    let length = monthLength(month, daysInYear, this.#leap);
    while (day >= length) {
      day -= length;
      month++;
      length = monthLength(month, daysInYear, this.#leap);
    }
    this.#month = month;
    this.#day = day + 1;
    return true;
  }

  field(index: number): number {
    switch (index) {
      case 0:
        return this.#year;
      case 1:
        return this.#month;
      case 2:
        return this.#day;
      case 3:
        return this.#dayOfYear;
      case 4:
        return monthLength(this.#month, this.#end - this.#start, this.#leap);
      case 5:
        return this.#end - this.#start;
      case 6:
        return this.#leap ? 13 : 12;
      case 7:
        return this.#leap ? 1 : 0;
      default:
        return NaN;
    }
  }

  monthCode(): string {
    if (this.#leap && this.#month === 5) return "M05L";
    const month = this.#month + 1 - (this.#leap && this.#month > 5 ? 1 : 0);
    return formatMonthCode(month);
  }

  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    if (
      !Number.isInteger(year) ||
      Math.abs(year) > 300000 ||
      !Number.isInteger(ordinalMonth) ||
      !Number.isInteger(day)
    )
      return NaN;
    const leap = modulo(7 * year + 1, 19) < 7;
    if (ordinalMonth < 0 || ordinalMonth >= (leap ? 13 : 12)) return NaN;
    const start =
      year === this.#year && Number.isFinite(this.#start) ? this.#start : yearStart(year);
    const daysInYear =
      year === this.#year && Number.isFinite(this.#end)
        ? this.#end - start
        : yearStart(year + 1) - start;
    if (day < 1 || day > monthLength(ordinalMonth, daysInYear, leap)) return NaN;
    let result = start + day - 1;
    for (let month = 0; month < ordinalMonth; month++)
      result += monthLength(month, daysInYear, leap);
    return result;
  }

  monthIndex(year: number, ordinalMonth: number): number {
    return calendarMonthIndex("hebrew", year, ordinalMonth);
  }

  yearFromMonthIndex(index: number): number {
    return calendarYearFromMonthIndex("hebrew", index);
  }
}
