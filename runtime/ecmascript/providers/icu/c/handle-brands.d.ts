// Type-only provenance markers; none is part of the native payload.
declare const timeZoneHandle: unique symbol;
declare const numberHandle: unique symbol;
declare const localeHandle: unique symbol;
declare const rangeHandle: unique symbol;
declare const collatorHandle: unique symbol;
declare const datePatternHandle: unique symbol;
declare const dateHandle: unique symbol;
declare const relativeHandle: unique symbol;
declare const pluralHandle: unique symbol;
declare const displayHandle: unique symbol;
declare const segmentHandle: unique symbol;
export interface TimeZoneHandleBrand {
  readonly [timeZoneHandle]: never;
}
export interface NumberHandleBrand {
  readonly [numberHandle]: never;
}
export interface LocaleHandleBrand {
  readonly [localeHandle]: never;
}
export interface NumberRangeHandleBrand {
  readonly [rangeHandle]: never;
}
export interface CollatorHandleBrand {
  readonly [collatorHandle]: never;
}
export interface DatePatternHandleBrand {
  readonly [datePatternHandle]: never;
}
export interface DateHandleBrand {
  readonly [dateHandle]: never;
}
export interface RelativeHandleBrand {
  readonly [relativeHandle]: never;
}
export interface PluralHandleBrand {
  readonly [pluralHandle]: never;
}
export interface DisplayHandleBrand {
  readonly [displayHandle]: never;
}
export interface SegmentHandleBrand {
  readonly [segmentHandle]: never;
}
