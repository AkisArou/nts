import { MS_PER_DAY, modulo } from "../date/calendar.ts";
import type { CalendarContext } from "../temporal/calendar-context.ts";
import { DateTimePattern, datePatternField, dateTimeSkeleton } from "./date-pattern.ts";
import type { DateTimeFormatterPrimitive, DateTimePatternData } from "./date-time-data.ts";
import { DateTimeTemplate } from "./date-time-template.ts";
import { FieldSpans } from "./parts.ts";

class CalendarDate {
  milliseconds = 0;
  time = 0;
  year = 0;
  code = 0;
  day = 0;
  dayOfYear = 0;

  load(milliseconds: number, offset: number, calendar: CalendarContext): void {
    if (!Number.isFinite(milliseconds) || !Number.isFinite(offset))
      throw new RangeError("Invalid calendar formatting instant");
    this.milliseconds = milliseconds;
    const local = milliseconds + offset;
    const day = Math.floor(local / MS_PER_DAY);
    const year = calendar.yearAt(day);
    const month = year.monthAt(day);
    this.time = local - day * MS_PER_DAY;
    this.year = year.year;
    this.code = year.monthCodeNumber(month);
    this.day = day - year.monthStart(month) + 1;
    this.dayOfYear = day - year.firstDay + 1;
  }
}

// CLDR interval patterns split at the first repeated field. Unrepeated fields
// are shared; repeated fields bound each endpoint's source span. Parsing and
// formatter construction happen only when that interval is first selected.
class CalendarInterval<P extends DateTimeFormatterPrimitive> {
  readonly first: P;
  readonly second: P;
  readonly laterFirst: boolean;
  readonly repeated: number;

  constructor(pattern: string, open: (pattern: string) => P) {
    this.laterFirst = pattern.startsWith("latestFirst:");
    if (this.laterFirst) pattern = pattern.slice(12);
    else if (pattern.startsWith("earliestFirst:")) pattern = pattern.slice(14);
    let seen = 0;
    let split = -1;
    let quoted = false;
    for (let index = 0; index < pattern.length; index++) {
      const symbol = pattern.charAt(index);
      if (symbol === "'") {
        if (pattern.charAt(index + 1) === "'") index++;
        else quoted = !quoted;
      } else if (!quoted) {
        const field = datePatternField(symbol);
        if (field < 0) continue;
        if ((seen & (1 << field)) !== 0) {
          split = index;
          break;
        }
        seen |= 1 << field;
        while (pattern.charAt(index + 1) === symbol) index++;
      }
    }
    if (split < 0) throw new RangeError("Interval pattern requires two endpoints");
    const first = new DateTimePattern(pattern.slice(0, split));
    const second = new DateTimePattern(pattern.slice(split));
    this.repeated = first.fieldMask & second.fieldMask;
    this.first = open(first.pattern);
    this.second = open(second.pattern);
  }
}

// One chronology for single dates and ranges. Providers receive presentation
// fields, never recalculate a lunisolar date or choose the public range shape.
export class CalendarDateFormatter<P extends DateTimeFormatterPrimitive> {
  readonly #primitive: P;
  readonly #calendar: CalendarContext;
  readonly #pattern: DateTimePattern;
  readonly #data: DateTimePatternData;
  readonly #open: (pattern: string) => P;
  readonly #start = new CalendarDate();
  #end: CalendarDate | undefined;
  #intervals: (CalendarInterval<P> | null | undefined)[] | undefined;
  #fallback: DateTimeTemplate | undefined;
  #dayPeriod: P | undefined;
  #spans: FieldSpans | undefined;
  #range = false;
  #length = 0;

  constructor(
    primitive: P,
    calendar: CalendarContext,
    pattern: DateTimePattern,
    data: DateTimePatternData,
    open: (pattern: string) => P,
  ) {
    if (calendar.identifier !== "chinese" && calendar.identifier !== "dangi")
      throw new RangeError("Prepared lunisolar formatting requires Chinese or Korean data");
    this.#primitive = primitive;
    this.#calendar = calendar;
    this.#pattern = pattern;
    this.#data = data;
    this.#open = open;
  }
  private render(primitive: P, date: CalendarDate, fields: boolean): string {
    primitive.setCalendarFields(
      date.year,
      modulo(date.year - 4, 60) + 1,
      (date.code % 100) - 1,
      date.code > 100,
      date.day,
      date.dayOfYear,
    );
    return primitive.format(date.milliseconds, fields);
  }
  format(milliseconds: number, fields: boolean): string {
    this.#range = false;
    this.#start.load(
      milliseconds,
      this.#primitive.offsetMilliseconds(milliseconds),
      this.#calendar,
    );
    return this.render(this.#primitive, this.#start, fields);
  }
  private difference(first: CalendarDate, last: CalendarDate): number {
    const mask = this.#pattern.fieldMask;
    let lastField = 1;
    if (mask & (1 << 2)) lastField = 2;
    if (mask & ((1 << 3) | (1 << 8))) lastField = 3;
    if (mask & (1 << 9)) lastField = 4;
    if (mask & (1 << 4)) lastField = 5;
    if (mask & (1 << 5)) lastField = 6;
    if (mask & (1 << 6)) lastField = 7;
    if (mask & (1 << 7)) lastField = 8;
    if (first.year !== last.year) return 1;
    if (lastField >= 2 && first.code !== last.code) return 2;
    if (lastField >= 3 && first.day !== last.day) return 3;
    if (lastField >= 4 && mask & (1 << 9)) {
      const pattern = this.#pattern.dayPeriodPattern;
      if (pattern === undefined) {
        if (Math.floor(first.time / 43200000) !== Math.floor(last.time / 43200000)) return 4;
      } else {
        // A direct single-field text primitive supplies the locale's day-period
        // identity. Never infer a period from unrelated localized date output.
        if (this.#dayPeriod === undefined) this.#dayPeriod = this.#open(pattern);
        if (
          this.render(this.#dayPeriod, first, false) !== this.render(this.#dayPeriod, last, false)
        )
          return 4;
      }
    }
    if (lastField >= 5 && Math.floor(first.time / 3600000) !== Math.floor(last.time / 3600000))
      return 5;
    if (lastField >= 6 && Math.floor(first.time / 60000) !== Math.floor(last.time / 60000))
      return 6;
    if (lastField >= 7 && Math.floor(first.time / 1000) !== Math.floor(last.time / 1000)) return 7;
    const digits = this.#pattern.components.fractionalSecondDigits;
    if (
      digits !== undefined &&
      Math.floor(first.time / 10 ** (3 - digits)) !== Math.floor(last.time / 10 ** (3 - digits))
    )
      return 8;
    return -1;
  }
  private interval(field: number): CalendarInterval<P> | null {
    if (field >= 7) return null;
    if (this.#intervals === undefined)
      this.#intervals = new Array<CalendarInterval<P> | null | undefined>(7);
    let result = this.#intervals[field];
    if (result !== undefined) return result;
    const cycle = this.#pattern.hourCycle ?? "h23";
    const skeleton = dateTimeSkeleton(this.#pattern.components, cycle);
    let pattern = this.#data.intervalPattern(skeleton, field);
    if (pattern.length > 0) {
      let metadata = new DateTimePattern(pattern.slice(pattern.indexOf(":") + 1));
      // CLDR's generic interval year token must keep the selected calendar's
      // presentation: related year and cyclic name are distinct public parts.
      if (this.#pattern.fieldMask & (1 << 11) && !(this.#pattern.fieldMask & (1 << 12)))
        metadata = new DateTimePattern(metadata.withRelatedYear());
      if (metadata.hourCycle !== undefined && metadata.hourCycle !== cycle)
        metadata = new DateTimePattern(metadata.withHourCycle(cycle));
      if (
        metadata.supported &&
        (metadata.fieldMask & this.#pattern.fieldMask) === this.#pattern.fieldMask
      )
        pattern = pattern.slice(0, pattern.indexOf(":") + 1) + metadata.pattern;
      else pattern = "";
    }
    result = pattern.length === 0 ? null : new CalendarInterval(pattern, this.#open);
    this.#intervals[field] = result;
    return result;
  }
  private span(field: number, start: number, end: number): void {
    if (this.#spans === undefined) this.#spans = new FieldSpans(24);
    let spans = this.#spans;
    if (spans.count === spans.fields.length) {
      const grown = new FieldSpans(spans.fields.length * 2);
      grown.fields.set(spans.fields);
      grown.starts.set(spans.starts);
      grown.ends.set(spans.ends);
      grown.count = spans.count;
      this.#spans = spans = grown;
    }
    spans.fields[spans.count] = field;
    spans.starts[spans.count] = start;
    spans.ends[spans.count] = end;
    spans.count++;
  }
  private append(
    primitive: P,
    date: CalendarDate,
    fields: boolean,
    source: number,
    mask: number,
  ): string {
    const text = this.render(primitive, date, fields);
    if (fields) {
      const whole = mask === 0x1fff;
      let first = whole ? 0 : text.length;
      let last = whole ? text.length : 0;
      const count = primitive.fieldCount();
      for (let index = 0; index < count; index++) {
        const field = primitive.field(index);
        const start = primitive.start(index);
        const end = primitive.end(index);
        this.span(field, this.#length + start, this.#length + end);
        if (mask & (1 << field)) {
          first = Math.min(first, start);
          last = Math.max(last, end);
        }
      }
      if (source !== 0 && last > first)
        this.span(source, this.#length + first, this.#length + last);
    }
    this.#length += text.length;
    return text;
  }
  formatRange(start: number, end: number, fields: boolean): string {
    this.#start.load(start, this.#primitive.offsetMilliseconds(start), this.#calendar);
    if (this.#end === undefined) this.#end = new CalendarDate();
    this.#end.load(end, this.#primitive.offsetMilliseconds(end), this.#calendar);
    const field = this.difference(this.#start, this.#end);
    this.#range = field >= 0;
    if (field < 0) return this.render(this.#primitive, this.#start, fields);
    if (this.#spans !== undefined) this.#spans.count = 0;
    this.#length = 0;
    const interval = this.interval(field);
    if (interval !== null) {
      const first = interval.laterFirst ? this.#end : this.#start;
      const last = interval.laterFirst ? this.#start : this.#end;
      return (
        this.append(
          interval.first,
          first,
          fields,
          interval.laterFirst ? 15 : 14,
          interval.repeated,
        ) +
        this.append(interval.second, last, fields, interval.laterFirst ? 14 : 15, interval.repeated)
      );
    }
    if (this.#fallback === undefined)
      this.#fallback = new DateTimeTemplate(this.#data.intervalFallback());
    const fallback = this.#fallback;
    this.#length = fallback.prefix.length;
    const first = this.append(
      this.#primitive,
      fallback.firstArgument === 1 ? this.#end : this.#start,
      fields,
      fallback.firstArgument === 1 ? 15 : 14,
      0x1fff,
    );
    this.#length += fallback.separator.length;
    const last = this.append(
      this.#primitive,
      fallback.firstArgument === 1 ? this.#start : this.#end,
      fields,
      fallback.firstArgument === 1 ? 14 : 15,
      0x1fff,
    );
    return fallback.prefix + first + fallback.separator + last + fallback.suffix;
  }
  fieldCount(): number {
    return this.#range ? (this.#spans?.count ?? 0) : this.#primitive.fieldCount();
  }
  rangeCollapsed(): boolean {
    return !this.#range;
  }
  field(index: number): number {
    return this.#range ? this.#spans!.fields[index]! : this.#primitive.field(index);
  }
  start(index: number): number {
    return this.#range ? this.#spans!.starts[index]! : this.#primitive.start(index);
  }
  end(index: number): number {
    return this.#range ? this.#spans!.ends[index]! : this.#primitive.end(index);
  }
}
