// Proleptic Gregorian arithmetic. Months in this module are zero based, as in
// Date; Temporal adapters convert at their boundary. No host Date or ICU calls.
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_DAY = 86400000;
export const DATE_LIMIT = 8640000000000000;

export function modulo(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

export function timeClip(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > DATE_LIMIT) return NaN;
  const integer = Math.trunc(value);
  return integer === 0 ? 0 : integer;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// March-based 400-year eras avoid iterative year searches and work for BCE.
export function epochDays(year: number, month: number, day: number): number {
  const adjustedYear = month < 2 ? year - 1 : year;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const marchMonth = month + (month > 1 ? -2 : 10);
  const dayOfYear = Math.floor((153 * marchMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function yearFromDays(days: number): number {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchMonth = Math.floor((5 * dayOfYear + 2) / 153);
  return era * 400 + yearOfEra + (marchMonth >= 10 ? 1 : 0);
}

export function yearFromTime(time: number): number {
  return yearFromDays(Math.floor(time / MS_PER_DAY));
}

export function dayWithinYear(time: number): number {
  const days = Math.floor(time / MS_PER_DAY);
  return days - epochDays(yearFromDays(days), 0, 1);
}

export function monthFromTime(time: number): number {
  if (Number.isNaN(time)) return NaN;
  const day = dayWithinYear(time);
  const leap = isLeapYear(yearFromTime(time)) ? 1 : 0;
  if (day < 31) return 0;
  if (day < 59 + leap) return 1;
  if (day < 90 + leap) return 2;
  if (day < 120 + leap) return 3;
  if (day < 151 + leap) return 4;
  if (day < 181 + leap) return 5;
  if (day < 212 + leap) return 6;
  if (day < 243 + leap) return 7;
  if (day < 273 + leap) return 8;
  if (day < 304 + leap) return 9;
  if (day < 334 + leap) return 10;
  return 11;
}

export function dateFromTime(time: number): number {
  return Math.floor(time / MS_PER_DAY) - epochDays(yearFromTime(time), monthFromTime(time), 1) + 1;
}

export function weekDay(time: number): number {
  return modulo(Math.floor(time / MS_PER_DAY) + 4, 7);
}
export function hourFromTime(time: number): number {
  return modulo(Math.floor(time / MS_PER_HOUR), 24);
}
export function minuteFromTime(time: number): number {
  return modulo(Math.floor(time / MS_PER_MINUTE), 60);
}
export function secondFromTime(time: number): number {
  return modulo(Math.floor(time / MS_PER_SECOND), 60);
}
export function millisecondFromTime(time: number): number {
  return modulo(time, MS_PER_SECOND);
}

export function makeDay(year: number, month: number, date: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) return NaN;
  const y = Math.trunc(year) + Math.floor(Math.trunc(month) / 12);
  const m = modulo(Math.trunc(month), 12);
  // Values this far outside Date's range cannot be rescued by a valid date
  // field. Retain arithmetic here: large opposing fields can cancel legally.
  return epochDays(y, m, 1) + Math.trunc(date) - 1;
}

export function makeTime(
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    !Number.isFinite(millisecond)
  )
    return NaN;
  return (
    Math.trunc(hour) * MS_PER_HOUR +
    Math.trunc(minute) * MS_PER_MINUTE +
    Math.trunc(second) * MS_PER_SECOND +
    Math.trunc(millisecond)
  );
}

export function makeDate(day: number, time: number): number {
  if (!Number.isFinite(day) || !Number.isFinite(time)) return NaN;
  const result = day * MS_PER_DAY + time;
  return Number.isFinite(result) ? result : NaN;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 1) return isLeapYear(year) ? 29 : 28;
  return month === 3 || month === 5 || month === 8 || month === 10 ? 30 : 31;
}
