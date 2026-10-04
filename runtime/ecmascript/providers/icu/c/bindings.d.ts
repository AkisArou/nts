declare module "c:nts_icu" {
  export type IcuTimeZoneHandle = import("./handle.ts").IcuTimeZoneHandle;
  export type IcuNumberHandle = import("./handle.ts").IcuNumberHandle;
  export type IcuLocaleHandle = import("./handle.ts").IcuLocaleHandle;
  export type IcuNumberRangeHandle = import("./handle.ts").IcuNumberRangeHandle;
  export type IcuCollatorHandle = import("./handle.ts").IcuCollatorHandle;
  export type IcuDatePatternHandle = import("./handle.ts").IcuDatePatternHandle;
  export type IcuDateHandle = import("./handle.ts").IcuDateHandle;
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
  export function nts_icu_date_range(handle: IcuDateHandle, start: number, end: number, fields: boolean): string | null;
  /** @ntsAbi managed */
  export function nts_icu_date_field_count(handle: IcuDateHandle): number;
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
  export function nts_icu_locale_values(tag: string, kind: number): string[] | null;
  /** @ntsAbi managed */
  export function nts_icu_locale_hour_cycle(tag: string): string | null;
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
