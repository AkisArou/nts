import type { ListPatternData } from "./list-data.ts";
import { ListPatterns } from "./list-pattern.ts";
import type { NumberFormatterPrimitive } from "./number-data.ts";
import { FieldSpans, NumberPartBuffer } from "./parts.ts";
import { DurationConfiguration } from "./duration-options.ts";
import { DurationPattern } from "./duration-pattern.ts";
import { durationDecimal, fractionalDurationValue } from "./duration-value.ts";

const units: readonly Intl.DurationFormatUnitSingular[] = [
  "year",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
  "microsecond",
  "nanosecond",
];
const widths = ["full-name", "short", "narrow"];

// Validated duration fields enter this physical formatting kernel. Options and
// ICU formatter configurations are fixed; provider state and parts scratch are
// lazy and reused. One owner borrows them until the next call.
export class DurationFormatter<D extends ListPatternData, P extends NumberFormatterPrimitive> {
  readonly #configuration: DurationConfiguration;
  readonly #pattern: DurationPattern;
  readonly #locale: string;
  readonly #open: (locale: string, skeleton: string, negativeSkeleton: string) => P;
  readonly #data: D;
  #list: ListPatterns<D> | undefined;
  readonly #formatters = new Array<P | undefined>(20);
  readonly #shown = new Uint8Array(10);
  readonly #hiddenSign = new Uint8Array(10);
  readonly #texts = new Array<string>(10);
  #spans: (FieldSpans | undefined)[] | undefined;
  #parts: NumberPartBuffer | undefined;
  #fraction = 0n;

  constructor(
    data: D,
    open: (locale: string, skeleton: string, negativeSkeleton: string) => P,
    locale: string,
    configuration: DurationConfiguration,
    pattern: DurationPattern,
  ) {
    this.#configuration = configuration;
    this.#pattern = pattern;
    this.#locale = locale;
    this.#open = open;
    this.#data = data;
  }

  private list(): ListPatterns<D> {
    let list = this.#list;
    if (list === undefined) {
      const style = this.#configuration.style;
      this.#list = list = new ListPatterns(
        this.#data,
        this.#locale,
        2,
        style === "long" ? 0 : style === "narrow" ? 2 : 1,
      );
    }
    return list;
  }

  private prepare(fields: Float64Array, negative: boolean): number {
    const config = this.#configuration;
    const fractional = config.firstFractional;
    this.#fraction = fractional === 10 ? 0n : fractionalDurationValue(fields, fractional);
    this.#shown.fill(0);
    const numeric = config.firstNumeric;
    const end = numeric === -1 ? (fractional === 10 ? 10 : fractional) : 7;
    let sign = true;
    let groups = 0;
    for (let index = 0; index < end; index++) {
      const nonzero =
        fractional !== 10 && index === fractional - 1 ? this.#fraction !== 0n : fields[index] !== 0;
      if (nonzero || config.always(index)) this.#shown[index] = 1;
    }
    if (numeric === 4 && this.#shown[4] === 1 && this.#shown[6] === 1) this.#shown[5] = 1;
    for (let index = 0; index < end; index++) {
      if (this.#shown[index] !== 1) continue;
      this.#hiddenSign[index] = !sign && negative ? 1 : 0;
      sign = false;
      if (numeric === -1 || index < numeric) groups++;
    }
    if (
      numeric !== -1 &&
      ((numeric === 4 && this.#shown[4] === 1) ||
        (numeric <= 5 && this.#shown[5] === 1) ||
        this.#shown[6] === 1)
    )
      groups++;
    return groups;
  }

  private formatter(index: number): P {
    const hidden = this.#hiddenSign[index] === 1;
    const key = index * 2 + Number(hidden);
    let formatter = this.#formatters[key];
    if (formatter !== undefined) return formatter;
    const config = this.#configuration;
    const code = config.code(index);
    const numeric = code === 3 || code === 4;
    const fraction =
      (numeric && index === 6) ||
      (config.firstFractional !== 10 && index === config.firstFractional - 1);
    let precision = ".###";
    if (fraction) {
      const digits = config.fractionalDigits;
      precision = digits === undefined ? ".#########" : "." + "0".repeat(digits);
    }
    let skeleton = precision + " rounding-mode-" + (fraction ? "down" : "half-up");
    if (numeric) skeleton += " group-off integer-width/*" + (code === 4 ? "00" : "0");
    else skeleton += " unit/" + units[index] + " unit-width-" + widths[code] + " group-auto";
    skeleton += hidden ? " sign-never" : " sign-auto";
    formatter = this.#open(this.#locale, skeleton, "");
    this.#formatters[key] = formatter;
    return formatter;
  }

  private formatUnit(
    fields: Float64Array,
    index: number,
    negative: boolean,
    parts: boolean,
  ): string {
    const formatter = this.formatter(index);
    const config = this.#configuration;
    if (index === config.firstFractional - 1 && this.#fraction !== 0n)
      return formatter.formatDecimal(
        durationDecimal(this.#fraction, (10 - config.firstFractional) * 3),
        parts,
        false,
      );
    const number = fields[index]!;
    const value = number === 0 && negative && this.#hiddenSign[index] === 0 ? -0 : number;
    return formatter.format(value, parts, false);
  }

  private numericText(): string {
    const first = this.#configuration.firstNumeric;
    let text = "";
    for (let index = first; index <= 6; index++) {
      if (this.#shown[index] !== 1) continue;
      if (index > first && this.#shown[index - 1] === 1)
        text += index === 5 ? this.#pattern.hourMinute : this.#pattern.minuteSecond;
      text += this.#texts[index]!;
    }
    return text;
  }

  format(fields: Float64Array, negative: boolean): string {
    const count = this.prepare(fields, negative);
    if (count === 0) return "";
    const items = count === 1 ? undefined : new Array<string>(count);
    const numeric = this.#configuration.firstNumeric;
    let output = 0;
    for (let index = 0; index < 10; index++) {
      if (this.#shown[index] !== 1) continue;
      const text = this.formatUnit(fields, index, negative, false);
      this.#texts[index] = text;
      if (numeric === -1 || index < numeric) {
        if (items === undefined) return text;
        items[output++] = text;
      }
    }
    if (items === undefined) return this.numericText();
    if (output < count) items[output] = this.numericText();
    return this.list().format(items);
  }

  private readSpans(index: number): FieldSpans {
    const formatter = this.formatter(index);
    const count = formatter.fieldCount();
    let spanList = this.#spans;
    if (spanList === undefined) this.#spans = spanList = new Array<FieldSpans | undefined>(10);
    let spans = spanList[index];
    if (spans === undefined || count > spans.fields.length) {
      spans = new FieldSpans(Math.max(count, spans === undefined ? 8 : spans.fields.length * 2));
      spanList[index] = spans;
    }
    spans.count = count;
    for (let position = 0; position < count; position++) {
      spans.fields[position] = formatter.field(position);
      spans.starts[position] = formatter.start(position);
      spans.ends[position] = formatter.end(position);
    }
    return spans;
  }

  private fill(
    parts: Intl.DurationFormatPart[],
    offset: number,
    index: number,
    negative: boolean,
  ): number {
    const buffer = this.#parts!;
    const text = this.#texts[index]!;
    buffer.prepare(text, this.#spans![index]!);
    let from = 0;
    while (from < text.length) {
      const end = buffer.segmentEnd(from, text.length);
      const type = buffer.partType(from, negative);
      const value = text.slice(from, end);
      const unit = units[index]!;
      // The standard part union gives literal records an optional unit.
      if (type === "literal") parts[offset++] = { type, value, unit };
      else parts[offset++] = { type, value, unit };
      from = end;
    }
    return offset;
  }

  formatToParts(fields: Float64Array, negative: boolean): Intl.DurationFormatPart[] {
    const count = this.prepare(fields, negative);
    if (count === 0) return [];
    let buffer = this.#parts;
    if (buffer === undefined) this.#parts = buffer = new NumberPartBuffer();
    const single = count === 1;
    const groups = single ? undefined : new Array<Intl.DurationFormatPart[]>(count);
    const items = single ? undefined : new Array<string>(count);
    const numeric = this.#configuration.firstNumeric;
    let group = 0;
    let numericCount = 0;
    for (let index = 0; index < 10; index++) {
      if (this.#shown[index] !== 1) continue;
      const text = this.formatUnit(fields, index, negative, true);
      this.#texts[index] = text;
      const size = buffer.prepare(text, this.readSpans(index));
      if (numeric === -1 || index < numeric) {
        const parts = new Array<Intl.DurationFormatPart>(size);
        this.fill(parts, 0, index, negative);
        if (single) return parts;
        groups![group] = parts;
        items![group++] = text;
      } else numericCount += size;
    }
    if (group < count) {
      if (numeric === 4 && this.#shown[4] === 1 && this.#shown[5] === 1) numericCount++;
      if (numeric <= 5 && this.#shown[5] === 1 && this.#shown[6] === 1) numericCount++;
      const parts = new Array<Intl.DurationFormatPart>(numericCount);
      let output = 0;
      for (let index = numeric; index <= 6; index++) {
        if (this.#shown[index] !== 1) continue;
        if (index > numeric && this.#shown[index - 1] === 1)
          parts[output++] = {
            type: "literal",
            value: index === 5 ? this.#pattern.hourMinute : this.#pattern.minuteSecond,
          };
        output = this.fill(parts, output, index, negative);
      }
      if (single) return parts;
      groups![group] = parts;
      items![group] = this.numericText();
    }
    const list = this.list().formatToParts(items!);
    let size = list.length - count;
    for (let index = 0; index < count; index++) size += groups![index]!.length;
    const parts = new Array<Intl.DurationFormatPart>(size);
    let output = 0;
    group = 0;
    for (let index = 0; index < list.length; index++) {
      const part = list[index]!;
      if (part.type === "literal") parts[output++] = { type: "literal", value: part.value };
      else {
        const fields = groups![group++]!;
        for (let field = 0; field < fields.length; field++) parts[output++] = fields[field]!;
      }
    }
    return parts;
  }
}
