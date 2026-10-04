// CLDR data capabilities. No public constructors or service algorithms are
// imported by provider adapters or the binding generator.
export interface LocaleData {
  canonicalize(tag: string): string;
  maximize(tag: string): string;
  minimize(tag: string): string;
  defaultLocale(): string;
  availableCount(): number;
  availableLocale(index: number): string;
  bestFit(tag: string): string | undefined;
  defaultNumberingSystem(locale: string): string;
  hasNumberingSystem(name: string): boolean;
  canonicalType(key: string, value: string): string;
}

export interface LocaleInfoData extends LocaleData {
  calendarValues(locale: string): string[];
  collationValues(locale: string): string[];
  hourCycle(locale: string): string;
  timeZones(region: string): string[];
  textDirection(script: string): number;
  // ICU weekday numbering: first day in bits 0..2, weekend day 1..7 in
  // bits 3..9. This is ABI storage, not a copied public WeekInfo.
  weekData(region: string): number;
}

export interface DateTimeLocaleData extends LocaleData {
  // Default calendar first, then all other calendars supported for formatting.
  // Locale's preferred-calendar list is the separate calendarValues query.
  availableCalendars(locale: string): string[];
}

export interface CollationData extends LocaleData {
  collationValues(locale: string): string[];
  // Sensitivity in bits 0..1, punctuation handling in bit 2 and case-first
  // in bits 3..4. This scalar is provider data, not a public options record.
  collationDefaults(locale: string): number;
}
