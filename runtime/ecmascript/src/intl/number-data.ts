// ICU text/field capability. This boundary has no dependency on a particular
// shared formatter class, so other Intl services can use the primitive directly.
export interface NumberFormatData {
  currencyDigits(currency: string): number;
}

export interface NumberFormatterPrimitive {
  format(value: number, fields: boolean, negative: boolean): string;
  formatDecimal(value: string, fields: boolean, negative: boolean): string;
  fieldCount(): number;
  field(index: number): number;
  start(index: number): number;
  end(index: number): number;
  formatRange(
    start: string,
    end: string,
    fields: boolean,
    negativeStart: boolean,
    negativeEnd: boolean,
  ): string;
}
