declare module "c:nts_icu" {
  export type IcuTimeZoneHandle = import("./handle.ts").IcuTimeZoneHandle;
  export type IcuNumberHandle = import("./handle.ts").IcuNumberHandle;
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
  export function nts_icu_number_field(
    handle: IcuNumberHandle,
    index: number,
    component: number,
  ): number;
}
