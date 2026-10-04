declare module "c:nts_icu" {
  export type IcuCalendarHandle = import("./handle.ts").IcuCalendarHandle;
  /** @ntsAbi managed */
  export function nts_icu_calendar_open(identifier: string): IcuCalendarHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_calendar_load(handle: IcuCalendarHandle, epochDay: number): boolean;
  /** @ntsAbi managed */
  export function nts_icu_calendar_field(handle: IcuCalendarHandle, index: number): number;
  /** @ntsAbi managed */
  export function nts_icu_calendar_month_code(handle: IcuCalendarHandle): string | null;
  /** @ntsAbi managed */
  export function nts_icu_calendar_to_day(
    handle: IcuCalendarHandle,
    extendedYear: number,
    ordinalMonth: number,
    day: number,
  ): number;
  export type IcuSegmentHandle = import("./handle.ts").IcuSegmentHandle;
  /** @ntsAbi managed */
  export function nts_icu_segment_open(
    locale: string,
    granularity: number,
  ): IcuSegmentHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_segment_text(
    handle: IcuSegmentHandle,
    input: string,
  ): IcuSegmentHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_segment_boundary(
    handle: IcuSegmentHandle,
    index: number,
    direction: number,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_segment_status(handle: IcuSegmentHandle): number;
  export type IcuTimeZoneHandle = import("./handle.ts").IcuTimeZoneHandle;
  export type IcuNumberHandle = import("./handle.ts").IcuNumberHandle;
  export type IcuLocaleHandle = import("./handle.ts").IcuLocaleHandle;
  export type IcuNumberRangeHandle = import("./handle.ts").IcuNumberRangeHandle;
  export type IcuCollatorHandle = import("./handle.ts").IcuCollatorHandle;
  export type IcuDatePatternHandle = import("./handle.ts").IcuDatePatternHandle;
  export type IcuDateHandle = import("./handle.ts").IcuDateHandle;
  export type IcuRelativeHandle = import("./handle.ts").IcuRelativeHandle;
  export type IcuPluralHandle = import("./handle.ts").IcuPluralHandle;
  export type IcuDisplayHandle = import("./handle.ts").IcuDisplayHandle;
  /** @ntsAbi managed */
  export function nts_icu_currency_named(code: string): boolean;
  /** @ntsAbi managed */
  export function nts_icu_display_open(
    locale: string,
    type: number,
    style: number,
    dialect: boolean,
  ): IcuDisplayHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_display_name(
    handle: IcuDisplayHandle,
    code: string,
    field: number,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_plural_open(
    locale: string,
    ordinal: boolean,
    skeleton: string,
    negativeSkeleton: string,
  ): IcuPluralHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_plural_categories(handle: IcuPluralHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_plural_select(
    handle: IcuPluralHandle,
    value: number,
    negative: boolean,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_plural_decimal(
    handle: IcuPluralHandle,
    value: string,
    negative: boolean,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_plural_range(
    handle: IcuPluralHandle,
    start: string,
    end: string,
    negativeStart: boolean,
    negativeEnd: boolean,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_relative_open(locale: string, style: number): IcuRelativeHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_relative_format(
    handle: IcuRelativeHandle,
    value: number,
    unit: number,
    auto: boolean,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_relative_field_count(handle: IcuRelativeHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_relative_field(
    handle: IcuRelativeHandle,
    index: number,
    component: number,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_date_open(
    locale: string,
    pattern: string,
    timeZone: string,
  ): IcuDateHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_date_format(
    handle: IcuDateHandle,
    milliseconds: number,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_field_locator(
    handle: IcuDateHandle,
    marker: string,
    pattern: string,
    markerCode: number,
  ): boolean;
  /** @ntsAbi managed */
  export function nts_icu_date_range(
    handle: IcuDateHandle,
    start: number,
    end: number,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_field_count(handle: IcuDateHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_date_range_collapsed(handle: IcuDateHandle): boolean;
  /** @ntsAbi managed */
  export function nts_icu_date_offset(handle: IcuDateHandle, milliseconds: number): number;
  /** @ntsAbi managed */
  export function nts_icu_date_calendar_fields(
    handle: IcuDateHandle,
    relatedYear: number,
    year: number,
    month: number,
    leap: boolean,
    day: number,
    dayOfYear: number,
  ): boolean;
  /** @ntsAbi managed */
  export function nts_icu_date_field(
    handle: IcuDateHandle,
    index: number,
    component: number,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_date_patterns_open(locale: string): IcuDatePatternHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_date_best_pattern(
    handle: IcuDatePatternHandle,
    skeleton: string,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_style_pattern(
    handle: IcuDatePatternHandle,
    dateStyle: number,
    timeStyle: number,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_patterns(handle: IcuDatePatternHandle): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_date_interval_pattern(
    handle: IcuDatePatternHandle,
    skeleton: string,
    field: number,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_interval_fallback(handle: IcuDatePatternHandle): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_time_connector(
    handle: IcuDatePatternHandle,
    dateStyle: number,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_collation_defaults(locale: string): number;
  /** @ntsAbi managed */
  export function nts_icu_collator_open(
    locale: string,
    sensitivity: number,
    punctuation: boolean,
    numeric: boolean,
    caseFirst: number,
  ): IcuCollatorHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_collator_compare(
    handle: IcuCollatorHandle,
    one: string,
    two: string,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_locale_open(): IcuLocaleHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_transform(tag: string, operation: number): string | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_default(): string | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_count(handle: IcuLocaleHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_locale_available(handle: IcuLocaleHandle, index: number): string | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_best_fit(handle: IcuLocaleHandle, tag: string): string | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_numbering(tag: string): string | null;
  /** @ntsAbi managed */
  export function nts_icu_numbering_supported(name: string): boolean;
  /** @ntsAbi managed */
  export function nts_icu_locale_type(key: string, value: string): string | null;
  /** @ntsAbi managed */
  export function nts_icu_script_is_hebrew(codePoint: number): boolean;
  /** @ntsAbi managed */
  export function nts_icu_locale_list_samples(
    locale: string,
    type: number,
    style: number,
    tokens: string[],
  ): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_duration_samples(locale: string): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_values(tag: string, kind: number): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_supported_values(category: number): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_timezone_primary(name: string): string | null;
  /** @ntsAbi managed */
  export function nts_icu_timezone_primary_names(): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_script_direction(script: string): number;
  /** @ntsAbi managed */
  export function nts_icu_locale_week(region: string): number;
  /** @ntsAbi managed */
  export function nts_icu_timezone_canonical(name: string): string | null;
  /** @ntsAbi managed */
  export function nts_icu_timezone_default(): string | null;
  /** @ntsAbi managed */
  export function nts_icu_versions_match(): boolean;
  /** @ntsAbi managed */
  export function nts_icu_timezone_open(id: string): IcuTimeZoneHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_timezone_id(handle: IcuTimeZoneHandle): string | null;
  /** @ntsAbi managed */
  export function nts_icu_timezone_offset(handle: IcuTimeZoneHandle, milliseconds: number): number;
  /** @ntsAbi managed */
  export function nts_icu_timezone_local_offset(
    handle: IcuTimeZoneHandle,
    milliseconds: number,
    former: boolean,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_timezone_transition(
    handle: IcuTimeZoneHandle,
    milliseconds: number,
    forward: boolean,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_number_open(locale: string, skeleton: string): IcuNumberHandle | null;

  /** @ntsAbi managed */
  export function nts_icu_currency_digits(currency: string): number;
  /** @ntsAbi managed */
  export function nts_icu_number_format(
    handle: IcuNumberHandle,
    value: number,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_number_decimal(
    handle: IcuNumberHandle,
    value: string,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_number_field_count(handle: IcuNumberHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_number_range_open(
    locale: string,
    startSkeleton: string,
    endSkeleton: string,
  ): IcuNumberRangeHandle | null;
  /** @ntsAbi managed */
  export function nts_icu_number_range_format(
    handle: IcuNumberRangeHandle,
    start: string,
    end: string,
    fields: boolean,
  ): string | null;
  /** @ntsAbi managed */
  export function nts_icu_number_range_field_count(handle: IcuNumberRangeHandle): number;
  /** @ntsAbi managed */
  export function nts_icu_number_range_field(
    handle: IcuNumberRangeHandle,
    index: number,
    component: number,
  ): number;
  /** @ntsAbi managed */
  export function nts_icu_number_field(
    handle: IcuNumberHandle,
    index: number,
    component: number,
  ): number;
}
