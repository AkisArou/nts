import {
  dateFromTime,
  hourFromTime,
  millisecondFromTime,
  minuteFromTime,
  monthFromTime,
  secondFromTime,
  weekDay,
  yearFromTime,
} from "./calendar.ts";
import { localTime } from "../time/provider.ts";
import type { TimeZoneRules } from "../time/provider.ts";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pad(value: number, digits: number): string {
  let text = String(value);
  while (text.length < digits) text = "0" + text;
  return text;
}

export function isoYear(year: number): string {
  return year >= 0 && year <= 9999 ? pad(year, 4) : (year < 0 ? "-" : "+") + pad(Math.abs(year), 6);
}

export function formatISO(time: number): string {
  if (!Number.isFinite(time)) throw new RangeError("Invalid time value");
  return (
    isoYear(yearFromTime(time)) +
    "-" +
    pad(monthFromTime(time) + 1, 2) +
    "-" +
    pad(dateFromTime(time), 2) +
    "T" +
    clockString(time) +
    "." +
    pad(millisecondFromTime(time), 3) +
    "Z"
  );
}

function clockString(time: number): string {
  return (
    pad(hourFromTime(time), 2) +
    ":" +
    pad(minuteFromTime(time), 2) +
    ":" +
    pad(secondFromTime(time), 2)
  );
}

function displayYear(year: number): string {
  return year < 0 ? "-" + pad(-year, 4) : pad(year, 4);
}

export function formatUTC(time: number): string {
  if (!Number.isFinite(time)) return "Invalid Date";
  return (
    weekdays[weekDay(time)]! +
    ", " +
    pad(dateFromTime(time), 2) +
    " " +
    months[monthFromTime(time)]! +
    " " +
    displayYear(yearFromTime(time)) +
    " " +
    clockString(time) +
    " GMT"
  );
}

export function formatDate(time: number, zone: TimeZoneRules): string {
  if (!Number.isFinite(time)) return "Invalid Date";
  const local = localTime(time, zone);
  return (
    weekdays[weekDay(local)]! +
    " " +
    months[monthFromTime(local)]! +
    " " +
    pad(dateFromTime(local), 2) +
    " " +
    displayYear(yearFromTime(local))
  );
}

export function formatTime(time: number, zone: TimeZoneRules): string {
  if (!Number.isFinite(time)) return "Invalid Date";
  const local = localTime(time, zone);
  const offset = zone.offsetMilliseconds(time);
  const minutes = Math.floor(Math.abs(offset) / 60000);
  return (
    clockString(local) +
    " GMT" +
    (offset < 0 ? "-" : "+") +
    pad(Math.floor(minutes / 60), 2) +
    pad(minutes % 60, 2)
  );
}

export function formatLocal(time: number, zone: TimeZoneRules): string {
  return Number.isFinite(time)
    ? formatDate(time, zone) + " " + formatTime(time, zone)
    : "Invalid Date";
}
