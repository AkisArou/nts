import { epochDays, yearFromDays, daysInMonth } from "../date/calendar.ts";
import { formatMonthCode } from "./calendar-month-code.ts";

// Gregorian variants, Alexandrian calendars, the Indian national calendar,
// and tabular Hijri calendars have exact arithmetic rules. They need no ICU
// handle, locale data or astronomical approximation. Canonical IDs arrive here
// after public calendar resolution; era names remain in calendar-eras.ts.
export class ArithmeticCalendar {
  readonly #kind: number;
  readonly #yearOffset: number;
  readonly #epoch: number;
  #year = 0;
  #start = NaN;
  #end = NaN;
  #month = 0;
  #day = 0;
  #dayOfYear = 0;
  #leap = false;

  constructor(identifier: string) {
    switch (identifier) {
      case "iso8601":
      case "gregory":
      case "japanese":
      case "buddhist":
      case "roc":
        this.#kind = 0;
        this.#yearOffset = identifier === "buddhist" ? 543 : identifier === "roc" ? -1911 : 0;
        this.#epoch = 0;
        break;
      case "coptic":
      case "ethiopic":
      case "ethioaa":
        this.#kind = 1;
        this.#yearOffset = identifier === "ethioaa" ? 5500 : 0;
        this.#epoch = identifier === "coptic" ? -615558 : -716367;
        break;
      case "indian":
        this.#kind = 2;
        this.#yearOffset = -78;
        this.#epoch = 0;
        break;
      case "islamic-civil":
      case "islamic-tbla":
        this.#kind = 3;
        this.#yearOffset = 0;
        this.#epoch = identifier === "islamic-tbla" ? -492149 : -492148;
        break;
      default:
        throw new RangeError("Calendar requires a different data source");
    }
  }

  private yearStart(year: number): number {
    const y = year - this.#yearOffset;
    switch (this.#kind) {
      case 0:
        return epochDays(y, 0, 1);
      case 1:
        return this.#epoch + 365 * (y - 1) + Math.floor(y / 4);
      case 2: {
        const february = daysInMonth(y, 1);
        return epochDays(y, 2, february === 29 ? 21 : 22);
      }
      default:
        return this.#epoch + 354 * (y - 1) + Math.floor((3 + 11 * y) / 30);
    }
  }

  private monthLength(month: number, year: number, leap: boolean): number {
    switch (this.#kind) {
      case 0:
        return daysInMonth(year - this.#yearOffset, month);
      case 1:
        return month < 12 ? 30 : leap ? 6 : 5;
      case 2:
        return month === 0 ? (leap ? 31 : 30) : month < 6 ? 31 : 30;
      default:
        return month === 11 ? (leap ? 30 : 29) : month % 2 === 0 ? 30 : 29;
    }
  }

  load(epochDay: number): boolean {
    if (!Number.isInteger(epochDay) || Math.abs(epochDay) > 100000400) return false;
    if (!(epochDay >= this.#start && epochDay < this.#end)) {
      let year: number;
      switch (this.#kind) {
        case 0:
        case 2:
          year = yearFromDays(epochDay) + this.#yearOffset;
          break;
        case 1:
          year = Math.floor((4 * (epochDay - this.#epoch) + 1463) / 1461) + this.#yearOffset;
          break;
        default:
          year = Math.floor((30 * (epochDay - this.#epoch) + 10646) / 10631);
          break;
      }
      let start = this.yearStart(year);
      while (start > epochDay) {
        year--;
        start = this.yearStart(year);
      }
      let end = this.yearStart(year + 1);
      while (end <= epochDay) {
        year++;
        start = end;
        end = this.yearStart(year + 1);
      }
      this.#year = year;
      this.#start = start;
      this.#end = end;
      this.#leap = end - start > (this.#kind === 3 ? 354 : 365);
    }
    let day = epochDay - this.#start;
    this.#dayOfYear = day + 1;
    let month = 0;
    let length = this.monthLength(month, this.#year, this.#leap);
    while (day >= length) {
      day -= length;
      month++;
      length = this.monthLength(month, this.#year, this.#leap);
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
        return this.monthLength(this.#month, this.#year, this.#leap);
      case 5:
        return this.#end - this.#start;
      case 6:
        return this.#kind === 1 ? 13 : 12;
      case 7:
        return this.#leap ? 1 : 0;
      default:
        return NaN;
    }
  }

  monthCode(): string {
    return formatMonthCode(this.#month + 1);
  }

  monthIndex(year: number, ordinalMonth: number): number {
    return year * (this.#kind === 1 ? 13 : 12) + ordinalMonth;
  }

  yearFromMonthIndex(index: number): number {
    return Math.floor(index / (this.#kind === 1 ? 13 : 12));
  }

  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    if (
      !Number.isInteger(year) ||
      Math.abs(year) > 300000 ||
      !Number.isInteger(ordinalMonth) ||
      !Number.isInteger(day)
    )
      return NaN;
    if (ordinalMonth < 0 || ordinalMonth >= (this.#kind === 1 ? 13 : 12)) return NaN;
    const start =
      year === this.#year && Number.isFinite(this.#start) ? this.#start : this.yearStart(year);
    const daysInYear =
      year === this.#year && Number.isFinite(this.#end)
        ? this.#end - start
        : this.yearStart(year + 1) - start;
    const leap = daysInYear > (this.#kind === 3 ? 354 : 365);
    if (day < 1 || day > this.monthLength(ordinalMonth, year, leap)) return NaN;
    let result = start + day - 1;
    for (let month = 0; month < ordinalMonth; month++)
      result += this.monthLength(month, year, leap);
    return result;
  }
}
