// Pattern data primitives, independent of the public DateTimeFormat API.
// Styles use ICU's scalar ABI: -1 absent, 0 full, 1 long, 2 medium, 3 short.
export interface DateTimePatternData {
  bestPattern(skeleton: string): string;
  stylePattern(dateStyle: number, timeStyle: number): string;
  patterns(): string[];
  // Interval fields: era, year, month, day, AM/PM, hour, minute. Empty means
  // that this skeleton has no interval pattern; ordering is an explicit prefix.
  intervalPattern(skeleton: string, field: number): string;
  intervalFallback(): string;
  dateTimeConnector(dateStyle: number): string;
}

// Text and UTF-16 field primitives. Shared code owns public options, clipping,
// matching and part objects; providers retain their formatter and scratch.
export interface DateTimeTextPrimitive {
  format(milliseconds: number, fields: boolean): string;
  formatRange(start: number, end: number, fields: boolean): string;
  rangeCollapsed(): boolean;
  fieldCount(): number;
  field(index: number): number;
  start(index: number): number;
  end(index: number): number;
}

// Raw providers expose zone offsets and accept calendar presentation fields.
// Parts partitioning only needs DateTimeTextPrimitive, so calendar adaptation
// composes outside that layer and cannot pull chronology into its raw path.
// Months are zero-based ordinals; monthCode uses the shared numeric encoding
// (M01 = 1, M05L = 105). Era ordinals use canonical presentation symbol order:
// Gregorian BCE/CE; Hijri AH/BH; ROC before/current; Ethiopic AA/AM; Japanese
// BCE/CE followed by Meiji, Taisho, Showa, Heisei, Reiwa; single eras use zero.
export interface DateTimeFormatterPrimitive extends DateTimeTextPrimitive {
  offsetMilliseconds(milliseconds: number): number;
  setCalendarFields(
    relatedYear: number,
    year: number,
    era: number,
    month: number,
    monthCode: number,
    day: number,
    dayOfYear: number,
  ): void;
}
