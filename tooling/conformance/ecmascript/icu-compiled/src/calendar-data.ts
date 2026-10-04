import { IcuCalendar } from "@nts/icu-calendar";
import { HebrewCalendar } from "../../../../../runtime/ecmascript/src/temporal/hebrew-calendar.ts";
import { ArithmeticCalendar } from "../../../../../runtime/ecmascript/src/temporal/arithmetic-calendar.ts";
import { LunisolarTable } from "../../../../../runtime/ecmascript/src/temporal/lunisolar-table.ts";
import {
  calendarEra,
  calendarEraYear,
} from "../../../../../runtime/ecmascript/src/temporal/calendar-eras.ts";

// Provider ABI/data witness, not a replacement for original Test262. Both
// configurations compile this source against their ordinary production adapter.
export function snapshot(identifier: string, epochDay: number): string {
  const calendar = new IcuCalendar(identifier);
  if (!calendar.load(epochDay)) throw new RangeError("Calendar golden could not be loaded");
  const year = calendar.field(0);
  const era = calendarEra(identifier, year, epochDay);
  let result = year + ":" + (calendar.field(1) + 1) + ":" + calendar.field(2);
  result += ":" + calendar.monthCode();
  for (let field = 3; field <= 6; field++) result += ":" + calendar.field(field);
  result += ":" + calendar.field(7);
  if (era === undefined) result += ":undefined:undefined";
  else result += ":" + era + ":" + calendarEraYear(identifier, era, year);
  return result;
}

export function roundTrips(identifier: string, first: number, count: number, step: number): number {
  const calendar = new IcuCalendar(identifier);
  let checksum = 0;
  for (let index = 0; index < count; index++) {
    const epochDay = first + index * step;
    if (!calendar.load(epochDay)) return -(index + 1);
    const year = calendar.field(0);
    const month = calendar.field(1);
    const day = calendar.field(2);
    const result = calendar.estimateEpochDay(year, month, day);
    if (result !== epochDay) return -(index + 1);
    checksum += day + month * 32;
  }
  return checksum;
}

export function invalidDate(identifier: string): boolean {
  const calendar = new IcuCalendar(identifier);
  if (!calendar.load(0)) return false;
  const year = calendar.field(0);
  return (
    Number.isNaN(calendar.estimateEpochDay(year, 0, 0)) &&
    Number.isNaN(calendar.estimateEpochDay(year, 99, 1)) &&
    Number.isNaN(calendar.estimateEpochDay(year, 0, 99))
  );
}

// The compact shared tables deliberately replace inaccurate modern ICU data.
// Validate their actual compiled representation separately from raw ICU parity.
export function tableSnapshot(identifier: string, epochDay: number): string {
  const calendar = new LunisolarTable(identifier);
  if (!calendar.load(epochDay)) throw new RangeError("Lunisolar table golden unavailable");
  return (
    calendar.field(0) +
    ":" +
    (calendar.field(1) + 1) +
    ":" +
    calendar.field(2) +
    ":" +
    calendar.monthCode()
  );
}

export function tableRoundTrips(identifier: string): number {
  const calendar = new LunisolarTable(identifier);
  const end = calendar.estimateEpochDay(identifier === "chinese" ? 2101 : 2051, 0, 1);
  if (!Number.isInteger(end)) return -1;
  for (let day = -25567; day < end; day++) {
    if (!calendar.load(day)) return day - end;
    if (calendar.estimateEpochDay(calendar.field(0), calendar.field(1), calendar.field(2)) !== day)
      return day - end;
  }
  return end + 25567;
}

// ICU4J's Hebrew cache can hang for negative years. The shared arithmetic
// calendar is checked against all public ICU fields in its modern range, and
// its full-range compiled conversion is exercised independently below.
export function hebrewProviderAgreement(first: number, count: number): number {
  const provider = new IcuCalendar("hebrew");
  const shared = new HebrewCalendar();
  for (let index = 0; index < count; index++) {
    const epochDay = first + index;
    if (!provider.load(epochDay) || !shared.load(epochDay)) return -(index + 1);
    for (let field = 0; field < 8; field++)
      if (provider.field(field) !== shared.field(field)) return -(index + 1);
    if (provider.monthCode() !== shared.monthCode()) return -(index + 1);
  }
  return count;
}

export function hebrewRoundTrips(first: number, count: number, step: number): number {
  const calendar = new HebrewCalendar();
  let checksum = 0;
  for (let index = 0; index < count; index++) {
    const epochDay = first + index * step;
    if (!calendar.load(epochDay)) return -(index + 1);
    const result = calendar.estimateEpochDay(
      calendar.field(0),
      calendar.field(1),
      calendar.field(2),
    );
    if (result !== epochDay) return -(index + 1);
    checksum += calendar.field(2) + calendar.field(1) * 32;
  }
  return checksum;
}

export function arithmeticProviderAgreement(
  identifier: string,
  first: number,
  count: number,
): number {
  const provider = new IcuCalendar(identifier);
  const shared = new ArithmeticCalendar(identifier);
  for (let index = 0; index < count; index++) {
    const epochDay = first + index;
    if (!provider.load(epochDay) || !shared.load(epochDay)) return -(index + 1);
    for (let field = 0; field < 8; field++)
      if (provider.field(field) !== shared.field(field)) return -(index + 1);
    if (provider.monthCode() !== shared.monthCode()) return -(index + 1);
  }
  return count;
}

export function arithmeticRoundTrips(
  identifier: string,
  first: number,
  count: number,
  step: number,
): number {
  const calendar = new ArithmeticCalendar(identifier);
  let checksum = 0;
  for (let index = 0; index < count; index++) {
    const epochDay = first + index * step;
    if (!calendar.load(epochDay)) return -(index + 1);
    const result = calendar.estimateEpochDay(
      calendar.field(0),
      calendar.field(1),
      calendar.field(2),
    );
    if (result !== epochDay) return -(index + 1);
    checksum += calendar.field(2) + calendar.field(1) * 32;
  }
  return checksum;
}
