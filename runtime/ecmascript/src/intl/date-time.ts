import type { DateTimeTextPrimitive } from "./date-time-data.ts";
import { FieldSpans } from "./parts.ts";

// Internal ABI codes, independent of either ICU's field enum or JS key order.
// The pinned TS library omits the specified relatedYear/yearName part types.
const fields: readonly (Intl.DateTimeFormatPart["type"] | "relatedYear" | "yearName")[] = [
  "era",
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "fractionalSecond",
  "weekday",
  "dayPeriod",
  "timeZoneName",
  "relatedYear",
  "yearName",
  "unknown",
];

// Correct the library's missing non-Gregorian part names without copying the
// other standard fields. This is also a physical record the compiler can use.
export interface DateTimeFormatPart extends Pick<Intl.DateTimeFormatPart, "value"> {
  type: Intl.DateTimeFormatPart["type"] | "relatedYear" | "yearName";
}
export interface DateTimeRangeFormatPart
  extends DateTimeFormatPart, Pick<Intl.DateTimeRangeFormatPart, "source"> {}

class DatePartBuffer {
  private cells = new Uint8Array(64);
  private sources = new Uint8Array(0);

  private read(text: string, spans: FieldSpans, range: boolean): void {
    if (this.cells.length < text.length)
      this.cells = new Uint8Array(Math.max(text.length, this.cells.length * 2));
    this.cells.fill(0, 0, text.length);
    if (range) {
      if (this.sources.length < text.length) this.sources = new Uint8Array(this.cells.length);
      this.sources.fill(0, 0, text.length);
    }
    for (let index = 0; index < spans.count; index++) {
      const field = spans.fields[index]!;
      const from = spans.starts[index]!;
      const to = spans.ends[index]!;
      if (
        field < 0 ||
        field >= (range ? 16 : fields.length) ||
        from < 0 ||
        to < from ||
        to > text.length
      )
        throw new RangeError("Invalid provider date field span");
      if (field >= 14) this.sources.fill(field - 13, from, to);
      else this.cells.fill(field + 1, from, to);
    }
  }
  partition(text: string, spans: FieldSpans): DateTimeFormatPart[] {
    this.read(text, spans, false);
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (index === 0 || this.cells[index] !== this.cells[index - 1]) count++;
    // Pick projects physical part fields for the compiler. Public APIs retain
    // the standard contract, supplemented only for the two missing part names.
    const parts = new Array<DateTimeFormatPart>(count);
    let from = 0;
    let output = 0;
    while (from < text.length) {
      const field = this.cells[from]!;
      let to = from + 1;
      while (to < text.length && this.cells[to] === field) to++;
      parts[output++] = {
        type: field === 0 ? "literal" : fields[field - 1]!,
        value: text.slice(from, to),
      };
      from = to;
    }
    return parts;
  }
  partitionRange(text: string, spans: FieldSpans): DateTimeRangeFormatPart[] {
    this.read(text, spans, true);
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (
        index === 0 ||
        this.cells[index] !== this.cells[index - 1] ||
        this.sources[index] !== this.sources[index - 1]
      )
        count++;
    const parts = new Array<DateTimeRangeFormatPart>(count);
    let from = 0;
    let output = 0;
    while (from < text.length) {
      const field = this.cells[from]!;
      const source = this.sources[from]!;
      let to = from + 1;
      while (to < text.length && this.cells[to] === field && this.sources[to] === source) to++;
      parts[output++] = {
        type: field === 0 ? "literal" : fields[field - 1]!,
        value: text.slice(from, to),
        source: source === 1 ? "startRange" : source === 2 ? "endRange" : "shared",
      };
      from = to;
    }
    return parts;
  }
}

export class DateTimeFormatter<P extends DateTimeTextPrimitive> {
  private readonly primitive: P;
  private parts: DatePartBuffer | undefined;
  private spans: FieldSpans | undefined;
  private readonly ranges: (() => DateTimeTextPrimitive) | undefined;
  private range: DateTimeTextPrimitive | undefined;
  constructor(primitive: P, ranges: (() => DateTimeTextPrimitive) | undefined = undefined) {
    this.primitive = primitive;
    this.ranges = ranges;
  }
  format(milliseconds: number): string {
    return this.primitive.format(milliseconds, false);
  }
  formatToParts(milliseconds: number): DateTimeFormatPart[] {
    const text = this.primitive.format(milliseconds, true);
    if (this.parts === undefined) this.parts = new DatePartBuffer();
    return this.parts.partition(text, this.readSpans(this.primitive));
  }
  private readSpans(primitive: DateTimeTextPrimitive): FieldSpans {
    const count = primitive.fieldCount();
    if (this.spans === undefined || this.spans.fields.length < count)
      this.spans = new FieldSpans(Math.max(count, (this.spans?.fields.length ?? 8) * 2));
    this.spans.count = count;
    for (let index = 0; index < count; index++) {
      this.spans.fields[index] = primitive.field(index);
      this.spans.starts[index] = primitive.start(index);
      this.spans.ends[index] = primitive.end(index);
    }
    return this.spans;
  }
  formatRange(start: number, end: number): string {
    return start === end
      ? this.primitive.format(start, false)
      : this.rangePrimitive().formatRange(start, end, false);
  }
  private rangePrimitive(): DateTimeTextPrimitive {
    if (this.ranges === undefined) return this.primitive;
    if (this.range === undefined) this.range = this.ranges();
    return this.range;
  }
  formatRangeToParts(start: number, end: number): DateTimeRangeFormatPart[] {
    const primitive = start === end ? this.primitive : this.rangePrimitive();
    const text =
      start === end ? primitive.format(start, true) : primitive.formatRange(start, end, true);
    if (this.parts === undefined) this.parts = new DatePartBuffer();
    return this.parts.partitionRange(text, this.readSpans(primitive));
  }
}
