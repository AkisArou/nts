import { MS_PER_DAY } from "../date/calendar.ts";
import { DateTimePattern, dateTimeSkeleton } from "./date-pattern.ts";
import type {
  DateTimeFormatterPrimitive,
  DateTimePatternData,
  DateTimeTextPrimitive,
} from "./date-time-data.ts";
import { DateTimeTemplate } from "./date-time-template.ts";
import { FieldSpans } from "./parts.ts";

// A same-day datetime range has one shared date and an independently selected
// time range. Keep this composition in TS instead of letting an ICU fallback
// repeat the date. Handles and scratch are lazy and reused by the formatter.
export class DateTimeRangeFormatter<P extends DateTimeFormatterPrimitive> {
  readonly #text: DateTimeTextPrimitive;
  readonly #zone: P;
  readonly #pattern: DateTimePattern;
  readonly #data: DateTimePatternData;
  readonly #open: (pattern: DateTimePattern) => DateTimeTextPrimitive;
  #date: DateTimeTextPrimitive | undefined;
  #time: DateTimeTextPrimitive | undefined;
  #connector: DateTimeTemplate | undefined;
  #spans: FieldSpans | undefined;
  #composed = false;
  #collapsed = true;

  constructor(
    text: DateTimeTextPrimitive,
    zone: P,
    pattern: DateTimePattern,
    data: DateTimePatternData,
    open: (pattern: DateTimePattern) => DateTimeTextPrimitive,
  ) {
    this.#text = text;
    this.#zone = zone;
    this.#pattern = pattern;
    this.#data = data;
    this.#open = open;
  }
  format(milliseconds: number, fields: boolean): string {
    this.#composed = false;
    this.#collapsed = true;
    return this.#text.format(milliseconds, fields);
  }
  private initialize(): void {
    const fields = this.#pattern.components;
    const cycle = this.#pattern.hourCycle ?? "h23";
    const date = new DateTimePattern(
      this.#data.bestPattern(
        dateTimeSkeleton(
          {
            weekday: fields.weekday,
            era: fields.era,
            year: fields.year,
            month: fields.month,
            day: fields.day,
          },
          cycle,
        ),
      ),
    );
    const time = new DateTimePattern(
      this.#data.bestPattern(
        dateTimeSkeleton(
          {
            dayPeriod: fields.dayPeriod,
            hour: fields.hour,
            minute: fields.minute,
            second: fields.second,
            fractionalSecondDigits: fields.fractionalSecondDigits,
            timeZoneName: fields.timeZoneName,
          },
          cycle,
        ),
      ),
    );
    this.#date = this.#open(date);
    this.#time = this.#open(time);
    const style =
      fields.month === "long"
        ? fields.weekday === undefined
          ? 1
          : 0
        : fields.month === "short"
          ? 2
          : 3;
    this.#connector = new DateTimeTemplate(this.#data.dateTimeConnector(style), "ldml");
  }
  private copy(primitive: DateTimeTextPrimitive, offset: number): void {
    const count = primitive.fieldCount();
    const used = this.#spans?.count ?? 0;
    if (this.#spans === undefined || this.#spans.fields.length < used + count) {
      const grown = new FieldSpans(Math.max(used + count, (this.#spans?.fields.length ?? 16) * 2));
      if (this.#spans !== undefined) {
        grown.fields.set(this.#spans.fields);
        grown.starts.set(this.#spans.starts);
        grown.ends.set(this.#spans.ends);
      }
      this.#spans = grown;
    }
    const spans = this.#spans;
    for (let index = 0; index < count; index++) {
      spans.fields[used + index] = primitive.field(index);
      spans.starts[used + index] = offset + primitive.start(index);
      spans.ends[used + index] = offset + primitive.end(index);
    }
    spans.count = used + count;
  }
  formatRange(start: number, end: number, fields: boolean): string {
    this.#composed = false;
    const firstDay = Math.floor((start + this.#zone.offsetMilliseconds(start)) / MS_PER_DAY);
    const lastDay = Math.floor((end + this.#zone.offsetMilliseconds(end)) / MS_PER_DAY);
    if (firstDay !== lastDay) {
      const text = this.#text.formatRange(start, end, fields);
      this.#collapsed = this.#text.rangeCollapsed();
      return text;
    }
    if (this.#time === undefined) this.initialize();
    const time = this.#time!;
    const timeText = time.formatRange(start, end, fields);
    if (time.rangeCollapsed()) return this.format(start, fields);
    const date = this.#date!;
    const connector = this.#connector!;
    const dateText = date.format(start, fields);
    this.#composed = true;
    this.#collapsed = false;
    if (this.#spans !== undefined) this.#spans.count = 0;
    if (fields) {
      const dateFirst = connector.firstArgument === 1;
      const firstLength = dateFirst ? dateText.length : timeText.length;
      this.copy(dateFirst ? date : time, connector.prefix.length);
      this.copy(
        dateFirst ? time : date,
        connector.prefix.length + firstLength + connector.separator.length,
      );
    }
    return (
      connector.prefix +
      (connector.firstArgument === 1 ? dateText : timeText) +
      connector.separator +
      (connector.firstArgument === 1 ? timeText : dateText) +
      connector.suffix
    );
  }
  rangeCollapsed(): boolean {
    return this.#collapsed;
  }
  fieldCount(): number {
    return this.#composed ? (this.#spans?.count ?? 0) : this.#text.fieldCount();
  }
  field(index: number): number {
    return this.#composed ? this.#spans!.fields[index]! : this.#text.field(index);
  }
  start(index: number): number {
    return this.#composed ? this.#spans!.starts[index]! : this.#text.start(index);
  }
  end(index: number): number {
    return this.#composed ? this.#spans!.ends[index]! : this.#text.end(index);
  }
}
