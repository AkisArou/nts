import { IcuLocaleData as NativeData } from "java:nts.intl";
import { IcuCollator as NativeCollator } from "java:nts.intl";
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
  private readonly handle = new NativeData();
  canonicalize(tag: string): string {
    return this.handle.canonicalize(tag);
  }
  durationSamples(locale: string): readonly string[] {
    return this.handle.durationSamples(locale);
  }
  maximize(tag: string): string {
    return this.handle.maximize(tag);
  }
  minimize(tag: string): string {
    return this.handle.minimize(tag);
  }
  defaultLocale(): string {
    return this.handle.defaultLocale();
  }
  availableCount(): number {
    return this.handle.availableCount();
  }
  availableLocale(index: number): string {
    return this.handle.availableLocale(index);
  }
  bestFit(tag: string): string | undefined {
    return this.handle.bestFit(tag) ?? undefined;
  }
  defaultNumberingSystem(locale: string): string {
    return this.handle.defaultNumberingSystem(locale);
  }
  hasNumberingSystem(name: string): boolean {
    return this.handle.hasNumberingSystem(name);
  }
  canonicalType(key: string, value: string): string {
    return this.handle.canonicalType(key, value);
  }
  availableValues(category: number): string[] {
    return this.handle.availableValues(category);
  }
  hasCurrencyName(code: string): boolean {
    return this.handle.hasCurrencyName(code);
  }
  calendarValues(locale: string): string[] {
    return hasCalendarPreferences(locale) ? this.handle.calendarValues(locale) : [];
  }
  availableCalendars(locale: string): string[] {
    return this.handle.availableCalendars(locale);
  }
  collationValues(locale: string): string[] {
    return this.handle.collationValues(locale);
  }
  collationDefaults(locale: string): number {
    return NativeCollator.defaults(locale);
  }
  hourCycleValues(locale: string): readonly string[] {
    return hourCycleValues(locale);
  }
  timeZones(region: string): string[] {
    return this.handle.timeZones(region);
  }
  timeZoneNames(): string[] {
    return this.handle.timeZoneNames();
  }
  canonicalTimeZone(name: string): string | undefined {
    return this.handle.canonicalTimeZone(name) ?? undefined;
  }
  primaryTimeZone(name: string): string | undefined {
    return this.handle.primaryTimeZone(name) ?? undefined;
  }
  primaryTimeZoneNames(): string[] {
    return this.handle.primaryTimeZoneNames();
  }
  defaultTimeZoneIdentifier(): string {
    return this.handle.defaultTimeZoneIdentifier();
  }
  textDirection(script: string): number {
    return this.handle.textDirection(script);
  }
  isHebrew(codePoint: number): boolean {
    return this.handle.isHebrew(codePoint);
  }
  listSamples(locale: string, type: number, style: number, tokens: string[]): string[] {
    return this.handle.listSamples(locale, type, style, tokens);
  }
  weekData(region: string): number {
    return hasWeekPreferences(region) ? this.handle.weekData(region) : NaN;
  }
}
