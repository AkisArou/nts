// Pattern data primitives, independent of the public DateTimeFormat API.
// Styles use ICU's scalar ABI: -1 absent, 0 full, 1 long, 2 medium, 3 short.
export interface DateTimePatternData {
  bestPattern(skeleton: string): string;
  stylePattern(dateStyle: number, timeStyle: number): string;
  patterns(): string[];
}

// Text and UTF-16 field primitives. Shared code owns public options, clipping,
// matching and part objects; providers retain their formatter and scratch.
export interface DateTimeFormatterPrimitive {
  format(milliseconds: number, fields: boolean): string;
  formatRange(start: number, end: number, fields: boolean): string;
  fieldCount(): number;
  field(index: number): number;
  start(index: number): number;
  end(index: number): number;
}
