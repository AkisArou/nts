import { daysInMonth } from "../date/calendar.ts";
import { NS_PER_HOUR, NS_PER_MINUTE, NS_PER_SECOND } from "./exact.ts";

function asciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// One scanner owns the ISO grammar shared by Instant and Plain/Zoned types.
// Its fields are parser storage, not another declaration of the public API.
export class ISOParser {
  private readonly input: string;
  private index = 0;
  year = 1970;
  month = 1;
  day = 1;
  hour = 0;
  minute = 0;
  second = 0;
  fractionalNanoseconds = 0;
  offsetNanoseconds = 0n;
  hasOffset = false;
  offsetHasSeconds = false;
  utcDesignator = false;
  timeZone: string | undefined;
  calendar = "iso8601";
  hasYear = true;
  hasDay = true;

  constructor(input: string, timeOnly = false, allowDateOnly = false, allowShortDate = false) {
    this.input = input;
    const prefixed = timeOnly && (this.take("T") || this.take("t"));
    const date =
      !timeOnly ||
      (!prefixed &&
        (this.input.charAt(0) === "+" ||
          this.input.charAt(0) === "-" ||
          (this.input.charAt(4) === "-" && this.input.charAt(7) === "-") ||
          (this.digitsAtStart(8) &&
            (this.input.charAt(8) === "T" ||
              this.input.charAt(8) === "t" ||
              this.input.charAt(8) === " "))));
    if (date) {
      const monthDay =
        allowShortDate &&
        (input.startsWith("--") ||
          input.charAt(2) === "-" ||
          (this.digitsAtStart(4) && (input.length === 4 || input.charAt(4) === "[")));
      if (monthDay) {
        if (this.take("-") && !this.take("-")) this.fail();
        this.year = 1972;
        this.hasYear = false;
        this.month = this.digits(2);
        this.take("-");
        this.day = this.digits(2);
      } else {
        const negative = this.take("-");
        const extended = negative || this.take("+");
        this.year = this.digits(extended ? 6 : 4) * (negative ? -1 : 1);
        if (negative && this.year === 0) this.fail();
        const separated = this.take("-");
        this.month = this.digits(2);
        if (allowShortDate && (this.index === input.length || input.charAt(this.index) === "[")) {
          this.day = 1;
          this.hasDay = false;
        } else {
          if (separated && !this.take("-")) this.fail();
          this.day = this.digits(2);
        }
      }
      if (
        !(
          this.month >= 1 &&
          this.month <= 12 &&
          this.day >= 1 &&
          this.day <= daysInMonth(this.year, this.month - 1)
        )
      )
        this.fail();
      if (!this.hasYear || !this.hasDay) {
        if (!allowDateOnly) this.fail();
        this.finish();
        return;
      }
      if (!this.take("T") && !this.take("t") && !this.take(" ")) {
        if (!allowDateOnly) this.fail();
        this.finish();
        return;
      }
    }
    const timeStart = this.index;
    this.hour = this.digits(2);
    const separated = this.take(":");
    if (separated || this.nextDigit()) {
      this.minute = this.digits(2);
      if ((separated && this.take(":")) || (!separated && this.nextDigit())) {
        this.second = this.digits(2);
        this.fractionalNanoseconds = this.fraction();
      }
    }
    const timeEnd = this.index;
    if (this.hour > 23 || this.minute > 59 || this.second > 60) this.fail();
    if (this.second === 60) this.second = 59;
    this.utcDesignator = this.take("Z") || this.take("z");
    if (this.utcDesignator) this.hasOffset = true;
    else if (this.input.charAt(this.index) === "+" || this.input.charAt(this.index) === "-") {
      this.offsetNanoseconds = this.offset(false);
      this.hasOffset = true;
    }
    const mainEnd = this.index;
    this.finish();
    if (timeOnly && !date && !prefixed && !separated) {
      const length = timeEnd - timeStart;
      if (this.input.charAt(timeEnd) === "-" && mainEnd === timeEnd + 3) {
        const suffix = Number(this.input.slice(timeEnd + 1, mainEnd));
        if (
          length === 2 &&
          this.hour >= 1 &&
          this.hour <= 12 &&
          suffix >= 1 &&
          suffix <= daysInMonth(1972, this.hour - 1)
        )
          this.fail();
        if (length === 4 && suffix >= 1 && suffix <= 12) this.fail();
      }
      if (length === 4 && mainEnd === timeEnd) {
        // An unprefixed time must not also parse as a month-day.
        if (
          this.hour >= 1 &&
          this.hour <= 12 &&
          this.minute >= 1 &&
          this.minute <= daysInMonth(1972, this.hour - 1)
        )
          this.fail();
      } else if (length === 6 && mainEnd === timeEnd && this.second >= 1 && this.second <= 12)
        this.fail();
    }
  }

  private fail(): never {
    throw new RangeError("Invalid Temporal ISO string");
  }
  private finish(): void {
    this.annotations();
    if (this.index !== this.input.length) this.fail();
  }
  private digitsAtStart(count: number): boolean {
    for (let index = 0; index < count; index++) {
      const code = this.input.charCodeAt(index);
      if (!(code >= 48 && code <= 57)) return false;
    }
    return true;
  }
  private take(character: string): boolean {
    if (this.input.charAt(this.index) !== character) return false;
    this.index++;
    return true;
  }
  private nextDigit(): boolean {
    const code = this.input.charCodeAt(this.index);
    return code >= 48 && code <= 57;
  }
  private digits(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index++) {
      const code = this.input.charCodeAt(this.index++);
      if (!(code >= 48 && code <= 57)) this.fail();
      value = value * 10 + code - 48;
    }
    return value;
  }
  private fraction(): number {
    if (!this.take(".") && !this.take(",")) return 0;
    let value = 0;
    let count = 0;
    while (this.nextDigit()) {
      if (count >= 9) this.fail();
      value = value * 10 + this.digits(1);
      count++;
    }
    if (count === 0) this.fail();
    return value * 10 ** (9 - count);
  }
  private offset(annotation: boolean): bigint {
    const negative = this.take("-");
    if (!negative && !this.take("+")) this.fail();
    const hour = this.digits(2);
    let minute = 0;
    let second = 0;
    let fractional = 0;
    const separated = this.take(":");
    if (separated || this.nextDigit()) {
      minute = this.digits(2);
      if (!annotation && ((separated && this.take(":")) || (!separated && this.nextDigit()))) {
        this.offsetHasSeconds = true;
        second = this.digits(2);
        fractional = this.fraction();
      }
    }
    if (hour > 23 || minute > 59 || second > 59) this.fail();
    const value =
      BigInt(hour) * NS_PER_HOUR +
      BigInt(minute) * NS_PER_MINUTE +
      BigInt(second) * NS_PER_SECOND +
      BigInt(fractional);
    return negative ? -value : value;
  }
  private annotations(): void {
    let calendars = 0;
    let criticalCalendar = false;
    let keyAnnotation = false;
    while (this.take("[")) {
      const critical = this.take("!");
      const start = this.index;
      while (this.index < this.input.length && this.input.charAt(this.index) !== "]") this.index++;
      const end = this.index;
      if (end === start || !this.take("]")) this.fail();
      const text = this.input.slice(start, end);
      const equals = text.indexOf("=");
      if (equals >= 0) {
        keyAnnotation = true;
        const key = text.slice(0, equals);
        const value = text.slice(equals + 1);
        if (key.length === 0 || value.length === 0) this.fail();
        for (let index = 0; index < key.length; index++) {
          const code = key.charCodeAt(index);
          if (
            !(
              (code >= 97 && code <= 122) ||
              code === 95 ||
              (index > 0 && ((code >= 48 && code <= 57) || code === 45))
            )
          )
            this.fail();
        }
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          if (
            !(
              asciiLetter(code) ||
              (code >= 48 && code <= 57) ||
              (code === 45 &&
                index > 0 &&
                index + 1 < value.length &&
                value.charAt(index - 1) !== "-")
            )
          )
            this.fail();
        }
        if (key === "u-ca") {
          calendars++;
          criticalCalendar = criticalCalendar || critical;
          if (calendars > 1 && criticalCalendar) this.fail();
          if (calendars === 1) this.calendar = value.toLowerCase();
        } else if (critical) this.fail();
      } else {
        if (this.timeZone !== undefined || keyAnnotation) this.fail();
        if (text.charAt(0) === "+" || text.charAt(0) === "-") {
          const resume = this.index;
          this.index = start;
          this.offset(true);
          if (this.index !== end) this.fail();
          this.index = resume;
        } else {
          const components = text.split("/");
          for (let component = 0; component < components.length; component++) {
            const part = components[component]!;
            if (part.length === 0 || part === "." || part === "..") this.fail();
            for (let index = 0; index < part.length; index++) {
              const code = part.charCodeAt(index);
              if (
                !(
                  asciiLetter(code) ||
                  code === 95 ||
                  code === 46 ||
                  (index > 0 && ((code >= 48 && code <= 57) || code === 45 || code === 43))
                )
              )
                this.fail();
            }
          }
        }
        this.timeZone = text;
      }
    }
  }

  timeNanoseconds(): number {
    return ((this.hour * 60 + this.minute) * 60 + this.second) * 1e9 + this.fractionalNanoseconds;
  }
}
