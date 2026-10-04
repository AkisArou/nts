import { IcuLocaleData as NativeData } from "java:nts.intl";
import { IcuCollator as NativeCollator } from "java:nts.intl";
import type { CollationData, LocaleInfoData, DateTimeLocaleData } from "../../../src/intl/locale-data.ts";
import type { TimeZoneIdentifierData } from "../../../src/time/zone-data.ts";

export class IcuLocaleData implements LocaleInfoData, DateTimeLocaleData, CollationData, TimeZoneIdentifierData {
  private readonly handle = new NativeData();
  canonicalize(tag: string): string {
    return this.handle.canonicalize(tag);
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
  calendarValues(locale: string): string[] {
    return this.handle.calendarValues(locale);
  }
  availableCalendars(locale: string): string[] { return this.handle.availableCalendars(locale); }
  collationValues(locale: string): string[] {
    return this.handle.collationValues(locale);
  }
  collationDefaults(locale: string): number {
    return NativeCollator.defaults(locale);
  }
  hourCycle(locale: string): string {
    return this.handle.hourCycle(locale);
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
  defaultTimeZoneIdentifier(): string {
    return this.handle.defaultTimeZoneIdentifier();
  }
  textDirection(script: string): number {
    return this.handle.textDirection(script);
  }
  weekData(region: string): number {
    return this.handle.weekData(region);
  }
}
