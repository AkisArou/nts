import { FieldSpans, NumberPartBuffer } from "./parts.ts";
import type { NumberFormatterPrimitive } from "./number-data.ts";
import { mathematicalValue } from "./mathematical-value.ts";
export type { NumberFormatterPrimitive } from "./number-data.ts";

// Typed integration API. ECMA-402 construction, options, locale resolution and
// bound-format accessors will bind to this shared formatting state.
export class NumberFormatter<P extends NumberFormatterPrimitive> {
  private readonly primitive: P;
  private readonly partition = new NumberPartBuffer();
  private readonly percentUnit: boolean;
  private readonly signRounding: boolean;
  private spans = new FieldSpans(16);
  constructor(primitive: P, percentUnit = false, signRounding = false) {
    this.primitive = primitive;
    this.percentUnit = percentUnit;
    this.signRounding = signRounding;
  }
  format(value: number): string {
    return this.primitive.format(value, false, value < 0 || Object.is(value, -0));
  }
  formatDecimal(value: string): string {
    return this.primitive.formatDecimal(value, false, value.startsWith("-"));
  }
  formatValue(input?: number | bigint | Intl.StringNumericLiteral): string {
    const value = mathematicalValue(input);
    return typeof value === "string" ? this.formatDecimal(value) : this.format(value);
  }
  formatToParts(value: number): Pick<Intl.NumberFormatPart, "type" | "value">[] {
    const text = this.primitive.format(value, true, value < 0 || Object.is(value, -0));
    return this.partition.partition(
      text,
      this.readSpans(),
      value < 0 || Object.is(value, -0),
      Number.isNaN(value),
      !Number.isFinite(value) && !Number.isNaN(value),
      this.percentUnit,
    );
  }
  formatDecimalToParts(value: string): Pick<Intl.NumberFormatPart, "type" | "value">[] {
    const text = this.primitive.formatDecimal(value, true, value.startsWith("-"));
    return this.partition.partition(
      text,
      this.readSpans(),
      value.startsWith("-"),
      false,
      false,
      this.percentUnit,
    );
  }
  private readSpans(): FieldSpans {
    const count = this.primitive.fieldCount();
    if (this.spans.fields.length < count)
      this.spans = new FieldSpans(Math.max(count, this.spans.fields.length * 2));
    this.spans.count = count;
    for (let i = 0; i < count; i++) {
      this.spans.fields[i] = this.primitive.field(i);
      this.spans.starts[i] = this.primitive.start(i);
      this.spans.ends[i] = this.primitive.end(i);
    }
    return this.spans;
  }
  private rangeEnd(start: string, end: string): string {
    if (this.signRounding && start.startsWith("-") !== end.startsWith("-")) {
      // Independent endpoint configurations disable ICU's identity fallback.
      // ECMA-402 compares formatted results; comparing complete strings does
      // not parse localized text. Keep the approximation/spans in ICU.
      const first =
        start === "-0" || start.endsWith("Infinity")
          ? this.primitive.format(Number(start), false, start.startsWith("-"))
          : this.primitive.formatDecimal(start, false, start.startsWith("-"));
      const last =
        end === "-0" || end.endsWith("Infinity")
          ? this.primitive.format(Number(end), false, end.startsWith("-"))
          : this.primitive.formatDecimal(end, false, end.startsWith("-"));
      if (first === last) return start;
    }
    return end;
  }
  formatRange(start: string, end: string): string {
    const last = this.rangeEnd(start, end);
    return this.primitive.formatRange(
      start,
      last,
      false,
      start.startsWith("-"),
      last.startsWith("-"),
    );
  }
  formatRangeToParts(
    start: string,
    end: string,
  ): Pick<Intl.NumberRangeFormatPart, "type" | "value" | "source">[] {
    const last = this.rangeEnd(start, end);
    const text = this.primitive.formatRange(
      start,
      last,
      true,
      start.startsWith("-"),
      last.startsWith("-"),
    );
    return this.partition.partitionRange(
      text,
      this.readSpans(),
      start.startsWith("-"),
      end.startsWith("-"),
      start === "Infinity" || start === "-Infinity",
      end === "Infinity" || end === "-Infinity",
      this.percentUnit,
    );
  }
}
