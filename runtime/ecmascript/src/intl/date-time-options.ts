import { LocaleResolver } from "./locale.ts";
import type { DateTimeLocaleData } from "./locale-data.ts";
import { LocaleIdentifier, validUnicodeType } from "./locale-id.ts";
import { stringOption, optionalString, numberOption } from "./options.ts";
import { DateTimePattern, dateTimeSkeleton, basicDateTimePattern } from "./date-pattern.ts";
import type { DateTimePatternData } from "./date-time-data.ts";
import { TimeZoneRegistry } from "../time/zone-id.ts";
import type { TimeZoneIdentifierData } from "../time/zone-data.ts";

const matchers: readonly NonNullable<Intl.DateTimeFormatOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const formatMatchers: readonly NonNullable<Intl.DateTimeFormatOptions["formatMatcher"]>[] = [
  "basic",
  "best fit",
];
const cycles: readonly Intl.LocaleHourCycleKey[] = ["h11", "h12", "h23", "h24"];
const words: readonly NonNullable<Intl.DateTimeFormatOptions["weekday"]>[] = [
  "narrow",
  "short",
  "long",
];
const numeric: readonly NonNullable<Intl.DateTimeFormatOptions["year"]>[] = ["2-digit", "numeric"];
const months: readonly NonNullable<Intl.DateTimeFormatOptions["month"]>[] = [
  "2-digit",
  "numeric",
  "narrow",
  "short",
  "long",
];
const zones: readonly NonNullable<Intl.DateTimeFormatOptions["timeZoneName"]>[] = [
  "short",
  "long",
  "shortOffset",
  "longOffset",
  "shortGeneric",
  "longGeneric",
];
const styles: readonly NonNullable<Intl.DateTimeFormatOptions["dateStyle"]>[] = [
  "full",
  "long",
  "medium",
  "short",
];
const fractions: readonly NonNullable<Intl.DateTimeFormatOptions["fractionalSecondDigits"]>[] = [
  1, 2, 3,
];

function option<T extends string>(value: T | undefined, allowed: readonly T[]): T | undefined {
  return value === undefined ? undefined : stringOption(value, allowed, allowed[0]!);
}
function unicodeType(value: string | undefined): string | undefined {
  const text = optionalString(value);
  if (text === undefined) return undefined;
  if (!validUnicodeType(text)) throw new RangeError("Invalid Unicode locale type");
  return text.toLowerCase();
}
function patternCycle<P extends DateTimePatternData>(
  patterns: P,
  skeleton: string,
): Intl.LocaleHourCycleKey {
  const cycle = new DateTimePattern(patterns.bestPattern(skeleton)).hourCycle;
  if (cycle === undefined) throw new Error("ICU hour pattern has no hour field");
  return cycle;
}

// Immutable construction state. Required: 0 any, 1 date, 2 time. Defaults:
// 0 date, 1 time, 2 all. These are internal selection codes, not public types.
export class DateTimeFormatConfiguration<
  D extends DateTimeLocaleData & TimeZoneIdentifierData,
  P extends DateTimePatternData,
> {
  readonly locale: string;
  readonly calendar: string;
  readonly numberingSystem: string;
  readonly timeZone: string;
  readonly dataLocale: string;
  readonly hourCycle: Intl.LocaleHourCycleKey;
  readonly dateStyle: Intl.DateTimeFormatOptions["dateStyle"];
  readonly timeStyle: Intl.DateTimeFormatOptions["timeStyle"];
  readonly components: Readonly<Intl.DateTimeFormatOptions>;
  readonly pattern: DateTimePattern;
  private readonly patterns: P;
  private readonly matcher: NonNullable<Intl.DateTimeFormatOptions["formatMatcher"]>;
  private candidates: DateTimePattern[] | undefined;

  constructor(
    resolver: LocaleResolver<D>,
    timeZones: TimeZoneRegistry<D>,
    open: (locale: string) => P,
    requested: readonly string[],
    options?: Readonly<Intl.DateTimeFormatOptions>,
    required: number = 0,
    defaults: number = 0,
  ) {
    if (options === null) throw new TypeError("Intl options must not be null");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    const rawCalendar = unicodeType(options?.calendar);
    const calendarOption =
      rawCalendar === undefined ? undefined : resolver.data.canonicalType("ca", rawCalendar);
    const numberingOption = unicodeType(options?.numberingSystem);
    const rawHour12 = options?.hour12;
    const hour12 = rawHour12 === undefined ? undefined : Boolean(rawHour12);
    const hourOption = option(options?.hourCycle, cycles);
    const selection = resolver.resolve(requested, matcher);
    const identifier = selection.requested;
    const calendars = resolver.data.availableCalendars(selection.locale);
    let calendar = calendars[0];
    if (calendar === undefined) throw new Error("ICU has no calendar for the selected locale");
    let calendarAddition: string | undefined;
    const extensionCalendar = identifier?.keyword("ca");
    if (extensionCalendar !== undefined && calendars.includes(extensionCalendar)) {
      calendar = extensionCalendar;
      calendarAddition = calendar;
    }
    if (
      calendarOption !== undefined &&
      calendars.includes(calendarOption) &&
      calendarOption !== calendar
    ) {
      calendar = calendarOption;
      calendarAddition = undefined;
    }
    // ECMA-402's deprecated observational calendars use a deterministic,
    // supported arithmetic fallback. The locale extension remains resolved.
    if (calendar === "islamic" || calendar === "islamic-rgsa") calendar = "islamic-civil";
    let numberingSystem = resolver.data.defaultNumberingSystem(selection.locale);
    let numberingAddition: string | undefined;
    const extensionNumbering = identifier?.keyword("nu");
    if (extensionNumbering !== undefined && resolver.data.hasNumberingSystem(extensionNumbering)) {
      numberingSystem = extensionNumbering;
      numberingAddition = numberingSystem;
    }
    if (
      numberingOption !== undefined &&
      resolver.data.hasNumberingSystem(numberingOption) &&
      numberingOption !== numberingSystem
    ) {
      numberingSystem = numberingOption;
      numberingAddition = undefined;
    }
    const baseLocale = new LocaleIdentifier(selection.locale).withKeywords(
      ["ca", "nu"],
      [calendar, numberingSystem],
    );
    const basePatterns = open(baseLocale);
    const defaultCycle = patternCycle(basePatterns, "j");
    let cycle = defaultCycle;
    let cycleAddition: string | undefined;
    if (hour12 === undefined) {
      const extensionCycle = identifier?.keyword("hc");
      for (let index = 0; index < cycles.length; index++)
        if (extensionCycle === cycles[index]) {
          cycle = cycles[index]!;
          cycleAddition = cycle;
        }
      if (hourOption !== undefined && hourOption !== cycle) {
        cycle = hourOption;
        cycleAddition = undefined;
      }
    } else cycle = patternCycle(basePatterns, hour12 ? "h" : "H");
    this.locale = new LocaleIdentifier(selection.locale).withKeywords(
      ["ca", "hc", "nu"],
      [calendarAddition, cycleAddition, numberingAddition],
    );
    this.calendar = calendar;
    this.numberingSystem = numberingSystem;
    this.hourCycle = cycle;
    this.dataLocale =
      cycle === defaultCycle
        ? baseLocale
        : new LocaleIdentifier(baseLocale).withKeyword("hc", cycle);
    this.patterns = cycle === defaultCycle ? basePatterns : open(this.dataLocale);
    const timeZone = optionalString(options?.timeZone);
    this.timeZone =
      timeZone === undefined ? timeZones.defaultIdentifier() : timeZones.resolve(timeZone);
    // Read each component exactly once, in specification table order.
    const weekday = option(options?.weekday, words);
    const era = option(options?.era, words);
    const year = option(options?.year, numeric);
    const month = option(options?.month, months);
    const day = option(options?.day, numeric);
    const dayPeriod = option(options?.dayPeriod, words);
    const hour = option(options?.hour, numeric);
    const minute = option(options?.minute, numeric);
    const second = option(options?.second, numeric);
    const rawFraction = options?.fractionalSecondDigits;
    const fractionalSecondDigits =
      rawFraction === undefined ? undefined : fractions[numberOption(rawFraction, 1, 3, 1) - 1]!;
    const timeZoneName = option(options?.timeZoneName, zones);
    this.matcher = stringOption(options?.formatMatcher, formatMatchers, "best fit");
    this.dateStyle = option(options?.dateStyle, styles);
    this.timeStyle = option(options?.timeStyle, styles);
    this.components = {
      weekday,
      era,
      year,
      month,
      day,
      dayPeriod,
      hour,
      minute,
      second,
      fractionalSecondDigits,
      timeZoneName,
    };
    if (this.dateStyle !== undefined || this.timeStyle !== undefined) {
      if (
        weekday !== undefined ||
        era !== undefined ||
        year !== undefined ||
        month !== undefined ||
        day !== undefined ||
        dayPeriod !== undefined ||
        hour !== undefined ||
        minute !== undefined ||
        second !== undefined ||
        fractionalSecondDigits !== undefined ||
        timeZoneName !== undefined
      )
        throw new TypeError("Date/time styles cannot be combined with format components");
      if (
        (required === 1 && this.timeStyle !== undefined) ||
        (required === 2 && this.dateStyle !== undefined)
      )
        throw new TypeError("Date/time style conflicts with the required format");
      this.pattern = new DateTimePattern(
        this.patterns.stylePattern(
          this.dateStyle === undefined ? -1 : styles.indexOf(this.dateStyle),
          this.timeStyle === undefined ? -1 : styles.indexOf(this.timeStyle),
        ),
      );
    } else this.pattern = this.match(this.withDefaults(this.components, required, defaults));
  }

  private withDefaults(
    fields: Readonly<Intl.DateTimeFormatOptions>,
    required: number,
    defaults: number,
  ): Readonly<Intl.DateTimeFormatOptions> {
    const date =
      fields.weekday !== undefined ||
      fields.year !== undefined ||
      fields.month !== undefined ||
      fields.day !== undefined;
    const time =
      fields.dayPeriod !== undefined ||
      fields.hour !== undefined ||
      fields.minute !== undefined ||
      fields.second !== undefined ||
      fields.fractionalSecondDigits !== undefined;
    if ((required !== 2 && date) || (required !== 1 && time)) return fields;
    return {
      ...fields,
      ...(defaults === 0 || defaults === 2
        ? { year: "numeric", month: "numeric", day: "numeric" }
        : {}),
      ...(defaults === 1 || defaults === 2
        ? { hour: "numeric", minute: "numeric", second: "numeric" }
        : {}),
    };
  }

  instantPattern(): DateTimePattern {
    return this.dateStyle !== undefined || this.timeStyle !== undefined
      ? this.pattern
      : this.match(this.withDefaults(this.components, 0, 2));
  }

  plainTimePattern(): DateTimePattern {
    if (this.timeStyle !== undefined) {
      const fields = this.pattern.components;
      if (this.dateStyle === undefined && fields.timeZoneName === undefined) return this.pattern;
      return this.match({
        dayPeriod: fields.dayPeriod,
        hour: fields.hour,
        minute: fields.minute,
        second: fields.second,
        fractionalSecondDigits: fields.fractionalSecondDigits,
      });
    }
    if (this.dateStyle !== undefined)
      throw new TypeError("A date style cannot format a plain time");
    const fields = this.components;
    const time =
      fields.dayPeriod !== undefined ||
      fields.hour !== undefined ||
      fields.minute !== undefined ||
      fields.second !== undefined ||
      fields.fractionalSecondDigits !== undefined;
    const date =
      fields.weekday !== undefined ||
      fields.year !== undefined ||
      fields.month !== undefined ||
      fields.day !== undefined;
    if (!time && date) throw new TypeError("Date components cannot format a plain time");
    return this.match(
      this.withDefaults(
        {
          dayPeriod: fields.dayPeriod,
          hour: fields.hour,
          minute: fields.minute,
          second: fields.second,
          fractionalSecondDigits: fields.fractionalSecondDigits,
        },
        2,
        1,
      ),
    );
  }

  plainDatePattern(): DateTimePattern {
    if (this.dateStyle !== undefined) {
      if (this.timeStyle === undefined) return this.pattern;
      const fields = this.pattern.components;
      return this.match({
        weekday: fields.weekday,
        era: fields.era,
        year: fields.year,
        month: fields.month,
        day: fields.day,
      });
    }
    if (this.timeStyle !== undefined)
      throw new TypeError("A time style cannot format a plain date");
    const fields = this.components;
    const date =
      fields.weekday !== undefined ||
      fields.year !== undefined ||
      fields.month !== undefined ||
      fields.day !== undefined;
    const time =
      fields.dayPeriod !== undefined ||
      fields.hour !== undefined ||
      fields.minute !== undefined ||
      fields.second !== undefined ||
      fields.fractionalSecondDigits !== undefined;
    if (!date && time) throw new TypeError("Time components cannot format a plain date");
    return this.match(
      this.withDefaults(
        {
          weekday: fields.weekday,
          era: fields.era,
          year: fields.year,
          month: fields.month,
          day: fields.day,
        },
        1,
        0,
      ),
    );
  }

  plainDateTimePattern(): DateTimePattern {
    if (this.dateStyle !== undefined || this.timeStyle !== undefined) {
      return this.pattern.components.timeZoneName === undefined
        ? this.pattern
        : this.match({ ...this.pattern.components, timeZoneName: undefined });
    }
    return this.match(this.withDefaults({ ...this.components, timeZoneName: undefined }, 0, 2));
  }

  plainPartialDatePattern(yearMonth: boolean): DateTimePattern {
    if (this.dateStyle === undefined && this.timeStyle !== undefined)
      throw new TypeError("A time style cannot format a partial date");
    const styles = this.dateStyle !== undefined;
    const fields = styles ? this.pattern.components : this.components;
    const relevant =
      fields.month !== undefined ||
      (yearMonth ? fields.year !== undefined : fields.day !== undefined);
    const others =
      fields.weekday !== undefined ||
      (yearMonth ? fields.day !== undefined : fields.year !== undefined) ||
      fields.dayPeriod !== undefined ||
      fields.hour !== undefined ||
      fields.minute !== undefined ||
      fields.second !== undefined ||
      fields.fractionalSecondDigits !== undefined;
    if (!styles && !relevant && others)
      throw new TypeError("Components cannot format this partial date");
    if (
      styles &&
      !others &&
      fields.timeZoneName === undefined &&
      (yearMonth || fields.era === undefined)
    )
      return this.pattern;
    return this.match({
      era: yearMonth ? fields.era : undefined,
      year: yearMonth ? (relevant || styles ? fields.year : "numeric") : undefined,
      month: relevant || styles ? fields.month : "numeric",
      day: !yearMonth ? (relevant || styles ? fields.day : "numeric") : undefined,
    });
  }

  private match(fields: Readonly<Intl.DateTimeFormatOptions>): DateTimePattern {
    let pattern: DateTimePattern;
    if (this.matcher === "basic") {
      if (this.candidates === undefined) {
        const raw = this.patterns.patterns().sort();
        this.candidates = new Array<DateTimePattern>(raw.length);
        for (let index = 0; index < raw.length; index++)
          this.candidates[index] = new DateTimePattern(raw[index]!);
      }
      pattern = basicDateTimePattern(fields, this.candidates);
    } else
      pattern = new DateTimePattern(
        this.patterns.bestPattern(dateTimeSkeleton(fields, this.hourCycle)),
      );
    return pattern.hourCycle === undefined || pattern.hourCycle === this.hourCycle
      ? pattern
      : new DateTimePattern(pattern.withHourCycle(this.hourCycle));
  }
}
