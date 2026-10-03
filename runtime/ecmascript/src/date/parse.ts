import { makeDate, makeDay, makeTime, timeClip, MS_PER_MINUTE } from "./calendar.ts";
import { utcTime } from "../time/provider.ts";
import type { TimeZoneRules } from "../time/provider.ts";

class Scanner {
  readonly text: string;
  index = 0;
  valid = true;
  constructor(text: string) {
    this.text = text;
  }
  take(character: string): boolean {
    if (this.text.charAt(this.index) !== character) return false;
    this.index++;
    return true;
  }
  digits(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i++) {
      const code = this.text.charCodeAt(this.index++);
      if (!(code >= 48 && code <= 57)) this.valid = false;
      result = result * 10 + code - 48;
    }
    return result;
  }
}

// The specification's Date Time String Format, parsed without regexp creation
// or host parsing. A date without a time is UTC; a time without an offset is
// local. A recognized ISO prefix never falls back to a lenient legacy grammar.
export function parseISO(text: string, zone: TimeZoneRules): number {
  const scanner = new Scanner(text);
  let sign = 1;
  let extended = false;
  if (scanner.take("-")) {
    sign = -1;
    extended = true;
  } else if (scanner.take("+")) extended = true;
  const year = sign * scanner.digits(extended ? 6 : 4);
  if (extended && sign === -1 && year === 0) return NaN;
  let month = 1;
  let date = 1;
  if (scanner.take("-")) {
    month = scanner.digits(2);
    if (scanner.take("-")) date = scanner.digits(2);
  }
  if (!(month >= 1 && month <= 12 && date >= 1 && date <= 31)) return NaN;
  const day = makeDay(year, month - 1, date);
  if (scanner.index === text.length && scanner.valid) return timeClip(makeDate(day, 0));
  if (!scanner.take("T")) return NaN;
  const hour = scanner.digits(2);
  if (!scanner.take(":")) return NaN;
  const minute = scanner.digits(2);
  let second = 0;
  let millisecond = 0;
  if (scanner.take(":")) {
    second = scanner.digits(2);
    if (scanner.take(".")) millisecond = scanner.digits(3);
  }
  if (!(hour >= 0 && hour <= 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60))
    return NaN;
  if (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0)) return NaN;
  const time = makeDate(day, makeTime(hour, minute, second, millisecond));
  let result = time;
  if (scanner.take("Z")) {
    /* UTC */
  } else if (scanner.index < text.length) {
    const negative = scanner.take("-");
    if (!negative && !scanner.take("+")) return NaN;
    const offsetHour = scanner.digits(2);
    if (!scanner.take(":")) return NaN;
    const offsetMinute = scanner.digits(2);
    if (!(offsetHour >= 0 && offsetHour <= 23 && offsetMinute >= 0 && offsetMinute <= 59))
      return NaN;
    result -= (negative ? -1 : 1) * (offsetHour * 60 + offsetMinute) * MS_PER_MINUTE;
  } else result = utcTime(time, zone);
  return scanner.valid && scanner.index === text.length ? timeClip(result) : NaN;
}

const monthNames = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function integer(text: string): number {
  if (text.length === 0) return NaN;
  let start = 0;
  let sign = 1;
  if (text.charAt(0) === "-") {
    start = 1;
    sign = -1;
  }
  if (start === text.length) return NaN;
  let value = 0;
  for (let i = start; i < text.length; i++) {
    const digit = text.charCodeAt(i) - 48;
    if (!(digit >= 0 && digit <= 9)) return NaN;
    value = value * 10 + digit;
  }
  return value * sign;
}

function monthIndex(text: string): number {
  const prefix = text.slice(0, 3);
  for (let i = 0; i < 12; i++) if (monthNames[i] === prefix) return i;
  return -1;
}

// Deliberately shared legacy policy: English RFC-style dates, emitted Date
// strings, and US slash-separated dates. Other implementation-defined strings
// are rejected identically on every backend rather than delegated to JRE/libc.
export function parseLegacy(input: string, zone: TimeZoneRules): number {
  const text = input.trim().toLowerCase();
  const words = new Array<string>(12);
  let count = 0;
  let start = 0;
  let commentDepth = 0;
  for (let i = 0; i <= text.length; i++) {
    const character = text.charAt(i);
    if (character === "(") commentDepth++;
    if (commentDepth > 0) {
      if (character === ")") commentDepth--;
      start = i + 1;
      continue;
    }
    if (
      i === text.length ||
      character === " " ||
      character === "," ||
      character === "\t" ||
      character === "\n"
    ) {
      if (i > start) {
        if (count === words.length) return NaN;
        words[count++] = text.slice(start, i);
      }
      start = i + 1;
    }
  }
  if (commentDepth !== 0 || count === 0) return NaN;
  let index = 0;
  for (let i = 0; i < 7; i++)
    if (words[0]!.slice(0, 3) === dayNames[i]) {
      index = 1;
      break;
    }
  let year = NaN;
  let month = NaN;
  let date = NaN;
  const first = words[index++]!;
  const slash = first.split("/");
  if (slash.length === 3) {
    month = integer(slash[0]!) - 1;
    date = integer(slash[1]!);
    year = integer(slash[2]!);
    if (year >= 0 && year < 100) year += year < 50 ? 2000 : 1900;
  } else {
    const namedMonth = monthIndex(first);
    if (namedMonth >= 0) {
      month = namedMonth;
      date = integer(words[index++] ?? "");
    } else {
      date = integer(first);
      month = monthIndex(words[index++] ?? "");
    }
    year = integer(words[index++] ?? "");
  }
  if (!(month >= 0 && month < 12 && date >= 1 && date <= 31 && Number.isFinite(year))) return NaN;
  let hour = 0;
  let minute = 0;
  let second = 0;
  if (index < count && words[index]!.includes(":")) {
    const clock = words[index++]!.split(":");
    if (clock.length < 2 || clock.length > 3) return NaN;
    hour = integer(clock[0]!);
    minute = integer(clock[1]!);
    second = clock.length === 3 ? integer(clock[2]!) : 0;
  }
  if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60))
    return NaN;
  if (index < count && (words[index] === "am" || words[index] === "pm")) {
    if (hour < 1 || hour > 12) return NaN;
    hour = (hour % 12) + (words[index++] === "pm" ? 12 : 0);
  }
  const time = makeDate(makeDay(year, month, date), makeTime(hour, minute, second, 0));
  if (index === count) return timeClip(utcTime(time, zone));
  let offset = words[index++]!;
  if (offset.startsWith("gmt") || offset.startsWith("utc")) offset = offset.slice(3);
  if (offset.length === 0 && index < count) offset = words[index++]!;
  if (index !== count) return NaN;
  if (offset === "" || offset === "z") return timeClip(time);
  const negative = offset.charAt(0) === "-";
  if (!negative && offset.charAt(0) !== "+") return NaN;
  const body = offset.slice(1).replace(":", "");
  if (body.length !== 4) return NaN;
  const offsetHour = integer(body.slice(0, 2));
  const offsetMinute = integer(body.slice(2));
  if (!(offsetHour >= 0 && offsetHour < 24 && offsetMinute >= 0 && offsetMinute < 60)) return NaN;
  return timeClip(time - (negative ? -1 : 1) * (offsetHour * 60 + offsetMinute) * MS_PER_MINUTE);
}

export function parseDate(text: string, zone: TimeZoneRules): number {
  const first = text.charAt(0);
  const fourDigitPrefix = text.length >= 4 && integer(text.slice(0, 4)) >= 1000;
  if (
    first === "+" ||
    (first === "-" && text.length >= 7) ||
    (fourDigitPrefix && (text.length === 4 || text.charAt(4) === "-"))
  )
    return parseISO(text, zone);
  // ISO years 0000..0999 are recognized separately from legacy numeric forms.
  if (
    text.length >= 4 &&
    Number.isFinite(integer(text.slice(0, 4))) &&
    (text.length === 4 || text.charAt(4) === "-")
  )
    return parseISO(text, zone);
  return parseLegacy(text, zone);
}
