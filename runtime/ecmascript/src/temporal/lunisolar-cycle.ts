import type { CalendarPrimitive } from "./calendar-data.ts";
import { CalendarYear } from "./calendar-year.ts";
import { epochDays, dateFromTime, monthFromTime, MS_PER_DAY } from "../date/calendar.ts";

// A bounded 19-year template for dates outside the required astronomical-data
// range. Its source years all lie within the provider's accurate modern range.
// Anchor each repetition to the same ISO month/day so arithmetic years stay
// aligned with ISO years. The 0/±1-day solar-cycle correction changes one lunar
// month in the final year, retaining 29/30-day month lengths and leap codes.
export class LunisolarCycle {
  readonly #years = new Array<CalendarYear>(19);
  readonly #monthOffsets = new Uint16Array(20);
  readonly #anchorYear: number;
  readonly #anchorMonth: number;
  readonly #anchorDay: number;
  readonly #originalFirst: number;
  readonly #originalLength: number;

  constructor(
    identifier: string,
    data: CalendarPrimitive,
    firstYear: number,
    anchorYear: number,
    anchorDay: number,
  ) {
    this.#anchorYear = anchorYear;
    const time = anchorDay * MS_PER_DAY;
    this.#anchorMonth = monthFromTime(time);
    this.#anchorDay = dateFromTime(time);
    for (let index = 0; index < 19; index++) {
      const year = firstYear + index;
      const first = data.estimateEpochDay(year, 0, 1);
      if (!Number.isInteger(first)) throw new RangeError("Lunisolar template data is unavailable");
      const result = new CalendarYear(identifier, data, first);
      if (result.year !== year || (index > 0 && this.#years[index - 1]!.endDay !== first))
        throw new RangeError("Lunisolar template boundaries disagree");
      this.#years[index] = result;
      this.#monthOffsets[index + 1] = this.#monthOffsets[index]! + result.monthsInYear;
    }
    this.#originalFirst = this.#years[0]!.firstDay;
    this.#originalLength = this.#years[18]!.endDay - this.#originalFirst;
    if (
      this.#originalLength < 6939 ||
      this.#originalLength > 6940 ||
      this.#monthOffsets[19] !== 235
    )
      throw new RangeError("Invalid lunisolar cycle length");
  }

  cycleYear(year: number): number {
    return this.#anchorYear + 19 * Math.floor((year - this.#anchorYear) / 19);
  }

  firstDay(cycleYear: number): number {
    return epochDays(cycleYear, this.#anchorMonth, this.#anchorDay);
  }

  template(year: number): CalendarYear {
    return this.#years[year - this.cycleYear(year)]!;
  }

  yearFirstDay(year: number): number {
    return this.firstDay(this.cycleYear(year)) + this.template(year).firstDay - this.#originalFirst;
  }

  correction(year: number): number {
    const cycle = this.cycleYear(year);
    return year !== cycle + 18
      ? 0
      : this.firstDay(cycle + 19) - this.firstDay(cycle) - this.#originalLength;
  }

  correctionMonth(year: number): number {
    const correction = this.correction(year);
    if (correction === 0) return -1;
    const template = this.template(year);
    for (let month = template.monthsInYear - 1; month >= 0; month--)
      if (template.daysInMonth(month) === (correction > 0 ? 29 : 30)) return month;
    throw new RangeError("Lunisolar cycle has no month for solar correction");
  }

  monthIndex(year: number, ordinalMonth: number): number {
    const cycle = Math.floor((year - this.#anchorYear) / 19);
    return cycle * 235 + this.#monthOffsets[year - this.#anchorYear - cycle * 19]! + ordinalMonth;
  }

  yearFromMonthIndex(index: number): number {
    const cycle = Math.floor(index / 235);
    const month = index - cycle * 235;
    let low = 0;
    let high = 19;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (month < this.#monthOffsets[middle]!) high = middle;
      else low = middle;
    }
    return this.#anchorYear + cycle * 19 + low;
  }
}
