import { canonicalizeLocale } from "./locale.ts";
import type { LocaleInfoData } from "./locale-data.ts";
import { LocalePreferences } from "./locale-preference.ts";
import {
  LocaleIdentifier,
  validLanguage,
  validScript,
  validRegion,
  validVariant,
  validUnicodeType,
} from "./locale-id.ts";
import { optionalString, stringOption } from "./options.ts";

const hourCycles: readonly Intl.LocaleHourCycleKey[] = ["h11", "h12", "h23", "h24"];
const caseFirstValues: readonly Intl.LocaleCollationCaseFirst[] = ["upper", "lower", "false"];
const weekdays: readonly string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const optionKeys: readonly string[] = ["ca", "co", "fw", "hc", "kf", "kn", "nu"];

function typeOption(value: string | undefined): string | undefined {
  const result = optionalString(value);
  if (result !== undefined && !validUnicodeType(result))
    throw new RangeError("Invalid Unicode locale option");
  return result;
}

export class NtsLocale<D extends LocaleInfoData> {
  readonly #data: D;
  readonly #tag: string;
  readonly #identifier: LocaleIdentifier;
  #preferences: LocalePreferences<D> | undefined;

  constructor(
    data: D,
    tag: string | Intl.Locale | NtsLocale<D>,
    // These two members are in the pinned ECMA-402 revision but missing
    // from TypeScript 7.0.2's LocaleOptions. Keep the existing contract direct.
    options: Readonly<Intl.LocaleOptions> & {
      readonly variants?: string;
      readonly firstDayOfWeek?: string | number;
    } = {},
  ) {
    if (typeof tag !== "string" && (tag === null || typeof tag !== "object"))
      throw new TypeError("Locale requires a string or locale object");
    const text = typeof tag === "string" ? tag : tag.toString();
    if (options === null) throw new TypeError("Locale options must not be null");
    let identifier = new LocaleIdentifier(canonicalizeLocale(data, text));
    const language = optionalString(options.language) ?? identifier.language;
    if (!validLanguage(language)) throw new RangeError("Invalid locale language");
    const script = optionalString(options.script) ?? identifier.script;
    if (script !== undefined && !validScript(script)) throw new RangeError("Invalid locale script");
    const region = optionalString(options.region) ?? identifier.region;
    if (region !== undefined && !validRegion(region)) throw new RangeError("Invalid locale region");
    const variantText = optionalString(options.variants);
    const variants =
      variantText === undefined ? identifier.variants : variantText.toLowerCase().split("-");
    const seen = new Set<string>();
    for (let index = 0; index < variants.length; index++) {
      const value = variants[index]!;
      if (!validVariant(value) || seen.has(value))
        throw new RangeError("Invalid or duplicate locale variant");
      seen.add(value);
    }
    const base = identifier.withBase(language, script, region, variants);
    const calendar = typeOption(options.calendar);
    const collation = typeOption(options.collation);
    const firstDayOption = options.firstDayOfWeek;
    let firstDay =
      firstDayOption === undefined ? undefined : optionalString(String(firstDayOption));
    if (typeof firstDayOption === "symbol")
      throw new TypeError("Locale string options reject Symbols");
    if (firstDay !== undefined) {
      if (firstDay.length === 1 && firstDay >= "0" && firstDay <= "7") {
        const index = Number(firstDay);
        firstDay = weekdays[index === 0 ? 6 : index - 1]!;
      }
      if (!validUnicodeType(firstDay)) throw new RangeError("Invalid first day identifier");
    }
    const hourCycleOption = options.hourCycle;
    const hourCycle =
      hourCycleOption === undefined ? undefined : stringOption(hourCycleOption, hourCycles, "h23");
    const caseFirstOption = options.caseFirst;
    const caseFirst =
      caseFirstOption === undefined
        ? undefined
        : stringOption(caseFirstOption, caseFirstValues, "false");
    const numeric = options.numeric;
    const numberingSystem = typeOption(options.numberingSystem);
    // Apply overrides only after all ordered option reads. The canonicalizer
    // owns CLDR aliases; the identifier owns placement and duplicate removal.
    const result = canonicalizeLocale(
      data,
      new LocaleIdentifier(base).withKeywords(optionKeys, [
        calendar?.toLowerCase(),
        collation?.toLowerCase(),
        firstDay?.toLowerCase(),
        hourCycle,
        caseFirst,
        numeric === undefined ? undefined : Boolean(numeric) ? "true" : "false",
        numberingSystem?.toLowerCase(),
      ]),
    );
    identifier = new LocaleIdentifier(result);
    this.#tag = result;
    this.#identifier = identifier;
    this.#data = data;
  }

  get baseName(): string {
    return this.#identifier.baseName;
  }
  get language(): string {
    return this.#identifier.language;
  }
  get script(): string | undefined {
    return this.#identifier.script;
  }
  get region(): string | undefined {
    return this.#identifier.region;
  }
  get variants(): string | undefined {
    return this.#identifier.variants.length === 0 ? undefined : this.#identifier.variants.join("-");
  }
  get calendar(): string | undefined {
    return this.#identifier.keyword("ca");
  }
  get collation(): string | undefined {
    return this.#identifier.keyword("co");
  }
  // The library narrows these extension getters to their valid option values,
  // but a structurally valid extension may contain an unrecognized value.
  get hourCycle(): string | undefined {
    return this.#identifier.keyword("hc");
  }
  get caseFirst(): string | undefined {
    return this.#identifier.keyword("kf");
  }
  get numeric(): boolean {
    const value = this.#identifier.keyword("kn");
    return value === "" || value === "true";
  }
  get numberingSystem(): string | undefined {
    return this.#identifier.keyword("nu");
  }
  get firstDayOfWeek(): string | undefined {
    return this.#identifier.keyword("fw");
  }

  maximize(): NtsLocale<D> {
    return new NtsLocale(this.#data, this.#data.maximize(this.#tag));
  }
  minimize(): NtsLocale<D> {
    return new NtsLocale(this.#data, this.#data.minimize(this.#tag));
  }
  toString(): string {
    return this.#tag;
  }

  private preferences(): LocalePreferences<D> {
    let preferences = this.#preferences;
    if (preferences === undefined) {
      preferences = new LocalePreferences(this.#data, this.#identifier);
      this.#preferences = preferences;
    }
    return preferences;
  }

  getCalendars(): string[] {
    return this.preferences().calendars();
  }
  getCollations(): string[] {
    const collation = this.#identifier.keyword("co");
    if (collation !== undefined) return [collation];
    const result = this.#data.collationValues(this.#identifier.baseName);
    // The default collation and search collation are not named sort choices.
    let count = 0;
    for (let index = 0; index < result.length; index++) {
      const value = result[index]!;
      if (value !== "standard" && value !== "search") result[count++] = value;
    }
    result.length = count;
    return result.sort();
  }
  getHourCycles(): string[] {
    return this.preferences().hourCycles();
  }
  getNumberingSystems(): string[] {
    return [
      this.#identifier.keyword("nu") ??
        this.#data.defaultNumberingSystem(this.#identifier.baseName),
    ];
  }
  getTimeZones(): string[] | undefined {
    const region = this.#identifier.region;
    if (region === undefined) return undefined;
    const values = this.#data.timeZones(region).sort();
    let count = 0;
    for (let index = 0; index < values.length; index++) {
      const value = values[index]!;
      if (count === 0 || value !== values[count - 1]) values[count++] = value;
    }
    values.length = count;
    return values;
  }
  getTextInfo(): Intl.TextInfo {
    const script =
      this.#identifier.script ?? new LocaleIdentifier(this.#data.maximize(this.#tag)).script;
    const direction = script === undefined ? -1 : this.#data.textDirection(script);
    return { direction: direction < 0 ? undefined : direction === 0 ? "ltr" : "rtl" };
  }
  getWeekInfo(): Intl.WeekInfo {
    const data = this.preferences().weekData();
    const option = this.#identifier.keyword("fw");
    let firstDay = (data & 7) === 1 ? 7 : (data & 7) - 1;
    for (let index = 0; index < weekdays.length; index++)
      if (option === weekdays[index]) firstDay = index + 1;
    let count = 0;
    for (let day = 1; day <= 7; day++) if ((data & (1 << (day + 2))) !== 0) count++;
    const weekend = new Array<number>(count);
    let index = 0;
    for (let day = 1; day <= 7; day++) {
      const icuDay = day === 7 ? 1 : day + 1;
      if ((data & (1 << (icuDay + 2))) !== 0) weekend[index++] = day;
    }
    return { firstDay, weekend };
  }
}
