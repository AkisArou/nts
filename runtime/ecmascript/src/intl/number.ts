import { FieldSpans, NumberPartBuffer } from "./parts.ts";

export interface NumberFormatterPrimitive {
  format(value: number, fields: boolean): string;
  formatDecimal(value: string, fields: boolean): string;
  fieldCount(): number;
  field(index: number): number;
  start(index: number): number;
  end(index: number): number;
}

// Typed integration API. ECMA-402 construction, options, locale resolution and
// bound-format accessors will bind to this shared formatting state.
export class NumberFormatter<P extends NumberFormatterPrimitive> {
  private readonly primitive: P;
  private readonly partition = new NumberPartBuffer();
  private spans = new FieldSpans(16);
  constructor(primitive: P) {
    this.primitive = primitive;
  }
  format(value: number): string {
    return this.primitive.format(value, false);
  }
  formatDecimal(value: string): string {
    return this.primitive.formatDecimal(value, false);
  }
  formatToParts(value: number): Omit<Intl.NumberRangeFormatPart, "source">[] {
    const text = this.primitive.format(value, true);
    return this.partition.partition(
      text,
      this.readSpans(),
      value < 0 || Object.is(value, -0),
      Number.isNaN(value),
      !Number.isFinite(value) && !Number.isNaN(value),
    );
  }
  formatDecimalToParts(value: string): Omit<Intl.NumberRangeFormatPart, "source">[] {
    const text = this.primitive.formatDecimal(value, true);
    return this.partition.partition(text, this.readSpans(), value.startsWith("-"), false, false);
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
}
