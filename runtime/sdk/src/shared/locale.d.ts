/**
 * @nts/sdk/locale — the user's localization facts.
 *
 * Standard part: `Intl` does formatting, collation, plural rules, and
 * most locale introspection (`Intl.Locale`, resolved options of the
 * formatters, `navigator.languages`). SDK part: the device settings
 * `Intl` does not report — 24-hour preference as the OS sets it,
 * temperature/measurement unit defaults, first weekday, text direction
 * of the *system* (vs a chosen locale).
 */

export interface LocaleInfo {
  /** BCP-47 tag of the system locale, e.g. "de-DE". */
  readonly tag: string;
  readonly language?: string;
  readonly region?: string;
  readonly currency?: string;
  readonly textDirection: "ltr" | "rtl";
  readonly uses24HourClock?: boolean;
  readonly temperatureUnit?: "celsius" | "fahrenheit";
  readonly measurementSystem?: "metric" | "imperial" | "uk";
  /** 1 = Sunday … 7 = Saturday, as the OS calendar defines it. */
  readonly firstWeekday?: number;
  /** IANA time zone, e.g. "Europe/Berlin" (same value Intl reports). */
  readonly timeZone: string;
  /** Calendar identifier in use ("gregory", "buddhist", …). */
  readonly calendar?: string;
}

export interface Locale {
  /** Ordered preferred locales (system first). Synchronous: known at startup. */
  readonly preferred: readonly LocaleInfo[];
}

export declare const locale: Locale;
