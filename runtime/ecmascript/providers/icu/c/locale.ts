import {
  nts_icu_locale_open,
  nts_icu_locale_transform,
  nts_icu_locale_default,
  nts_icu_locale_count,
  nts_icu_locale_available,
  nts_icu_locale_best_fit,
  nts_icu_locale_numbering,
  nts_icu_numbering_supported,
  nts_icu_locale_type,
  nts_icu_locale_values,
  nts_icu_supported_values,
  nts_icu_currency_named,
  nts_icu_timezone_primary,
  nts_icu_timezone_primary_names,
  nts_icu_script_direction,
  nts_icu_script_is_hebrew,
  nts_icu_locale_list_samples,
  nts_icu_locale_duration_samples,
  nts_icu_locale_week,
  nts_icu_collation_defaults,
  nts_icu_timezone_canonical,
  nts_icu_timezone_default,
} from "c:nts_icu";
import type { IcuLocaleHandle } from "c:nts_icu";
import type {
  CollationData,
  LocaleInfoData,
  DateTimeLocaleData,
} from "../../../src/intl/locale-data.ts";
import type { TimeZoneIdentifierData } from "../../../src/time/zone-data.ts";
import type { ListPatternData } from "../../../src/intl/list-data.ts";
import type { DurationPatternData } from "../../../src/intl/duration-data.ts";
import type { SupportedValueData } from "../../../src/intl/supported-value-data.ts";
import {
  hasCalendarPreferences,
  hasWeekPreferences,
  hourCycleValues,
} from "../shared/locale-preferences.ts";

function required(value: string | null): string {
  if (value === null) throw new RangeError("ICU locale data operation failed");
  return value;
}

export class IcuLocaleData
  implements
    LocaleInfoData,
    DateTimeLocaleData,
    CollationData,
    TimeZoneIdentifierData,
    ListPatternData,
    DurationPatternData,
    SupportedValueData
{
  private readonly handle: IcuLocaleHandle;
  constructor() {
    const handle = nts_icu_locale_open();
    if (handle === null) throw new Error("ICU locale data could not be opened");
    this.handle = handle;
  }
  canonicalize(tag: string): string {
    return required(nts_icu_locale_transform(tag, 0));
  }
  durationSamples(locale: string): readonly string[] {
    const samples = nts_icu_locale_duration_samples(locale);
    if (samples === null) throw new Error("ICU duration samples could not be read");
    return samples;
  }
  maximize(tag: string): string {
    return required(nts_icu_locale_transform(tag, 1));
  }
  minimize(tag: string): string {
    return required(nts_icu_locale_transform(tag, 2));
  }
  defaultLocale(): string {
    return required(nts_icu_locale_default());
  }
  availableCount(): number {
    return nts_icu_locale_count(this.handle);
  }
  availableLocale(index: number): string {
    return required(nts_icu_locale_available(this.handle, index));
  }
  bestFit(tag: string): string | undefined {
    return nts_icu_locale_best_fit(this.handle, tag) ?? undefined;
  }
  defaultNumberingSystem(locale: string): string {
    return required(nts_icu_locale_numbering(locale));
  }
  hasNumberingSystem(name: string): boolean {
    return nts_icu_numbering_supported(name);
  }
  canonicalType(key: string, value: string): string {
    return required(nts_icu_locale_type(key, value));
  }
  availableValues(category: number): string[] {
    const values = nts_icu_supported_values(category);
    if (values === null) throw new RangeError("ICU supported-value enumeration failed");
    return values;
  }
  hasCurrencyName(code: string): boolean {
    return nts_icu_currency_named(code);
  }
  calendarValues(locale: string): string[] {
    if (!hasCalendarPreferences(locale)) return [];
    const values = nts_icu_locale_values(locale, 0);
    if (values === null) throw new RangeError("ICU calendar data operation failed");
    return values;
  }
  availableCalendars(locale: string): string[] {
    const values = nts_icu_locale_values(locale, 4);
    if (values === null) throw new RangeError("ICU calendar availability operation failed");
    return values;
  }
  collationValues(locale: string): string[] {
    const values = nts_icu_locale_values(locale, 1);
    if (values === null) throw new RangeError("ICU collation data operation failed");
    return values;
  }
  collationDefaults(locale: string): number {
    const result = nts_icu_collation_defaults(locale);
    if (Number.isNaN(result)) throw new RangeError("ICU collator data operation failed");
    return result;
  }
  hourCycleValues(locale: string): readonly string[] {
    return hourCycleValues(locale);
  }
  timeZones(region: string): string[] {
    const values = nts_icu_locale_values(region, 2);
    if (values === null) throw new RangeError("ICU time-zone data operation failed");
    return values;
  }
  timeZoneNames(): string[] {
    const names = nts_icu_locale_values("", 3);
    if (names === null) throw new RangeError("ICU time-zone enumeration failed");
    return names;
  }
  canonicalTimeZone(name: string): string | undefined {
    return nts_icu_timezone_canonical(name) ?? undefined;
  }
  primaryTimeZone(name: string): string | undefined {
    return nts_icu_timezone_primary(name) ?? undefined;
  }
  primaryTimeZoneNames(): string[] {
    const names = nts_icu_timezone_primary_names();
    if (names === null) throw new RangeError("ICU primary time-zone enumeration failed");
    return names;
  }
  defaultTimeZoneIdentifier(): string {
    return required(nts_icu_timezone_default());
  }
  textDirection(script: string): number {
    return nts_icu_script_direction(script);
  }
  isHebrew(codePoint: number): boolean {
    return nts_icu_script_is_hebrew(codePoint);
  }
  listSamples(locale: string, type: number, style: number, tokens: string[]): string[] {
    const samples = nts_icu_locale_list_samples(locale, type, style, tokens);
    if (samples === null) throw new RangeError("ICU list data operation failed");
    return samples;
  }
  weekData(region: string): number {
    if (!hasWeekPreferences(region)) return NaN;
    const value = nts_icu_locale_week(region);
    if (!Number.isFinite(value)) throw new RangeError("ICU week data operation failed");
    return value;
  }
}
