import type { LocaleInfoData } from "./locale-data.ts";
import { LocaleIdentifier, validRegion } from "./locale-id.ts";
import { availableCalendar } from "./calendar-id.ts";

// One immutable locale's supplemental preferences. Each category resolves
// override/base fallback independently; private lazy caches never escape.
export class LocalePreferences<D extends LocaleInfoData> {
  readonly #data: D;
  readonly #identifier: LocaleIdentifier;
  #override: string | undefined;
  #overrideResolved = false;
  #region: string | undefined;
  #calendars: readonly string[] | undefined;
  #hours: readonly string[] | undefined;
  #week = NaN;

  constructor(data: D, identifier: LocaleIdentifier) {
    this.#data = data;
    this.#identifier = identifier;
  }

  private subdivision(key: string): string | undefined {
    const value = this.#identifier.keyword(key);
    if (value === undefined) return undefined;
    const region = value.slice(0, value.charCodeAt(0) >= 48 && value.charCodeAt(0) <= 57 ? 3 : 2);
    if (!validRegion(region) || value.length === region.length) return undefined;
    for (let index = region.length; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122))) return undefined;
    }
    // The region syntax is already validated; ICU supplies territory aliases.
    return new LocaleIdentifier(this.#data.canonicalize("und-" + region)).region;
  }

  private region(): string {
    let region = this.#region;
    if (region === undefined) {
      region =
        this.#identifier.region ??
        this.subdivision("sd") ??
        new LocaleIdentifier(this.#data.maximize(this.#identifier.baseName)).region ??
        "001";
      this.#region = region;
    }
    return region;
  }

  private override(): string | undefined {
    if (!this.#overrideResolved) {
      this.#override = this.subdivision("rg");
      this.#overrideResolved = true;
    }
    return this.#override;
  }

  calendars(): string[] {
    let cached = this.#calendars;
    if (cached === undefined) {
      const keyword = this.#identifier.keyword("ca");
      if (keyword !== undefined) cached = [keyword];
      else {
        const override = this.override();
        let values =
          override === undefined
            ? []
            : this.#data.calendarValues(this.#identifier.language + "-" + override);
        if (values.length === 0)
          values = this.#data.calendarValues(this.#identifier.language + "-" + this.region());
        let count = 0;
        for (let index = 0; index < values.length; index++) {
          const value = values[index]!;
          if (!availableCalendar(value)) continue;
          let duplicate = false;
          for (let previous = 0; previous < count; previous++)
            if (values[previous] === value) duplicate = true;
          if (!duplicate) values[count++] = value;
        }
        values.length = count;
        cached = count === 0 ? ["gregory"] : values;
      }
      this.#calendars = cached;
    }
    return cached.slice();
  }

  hourCycles(): string[] {
    let cached = this.#hours;
    if (cached === undefined) {
      const keyword = this.#identifier.keyword("hc");
      if (keyword !== undefined) cached = [keyword];
      else {
        const override = this.override();
        let values =
          override === undefined
            ? []
            : this.#data.hourCycleValues(this.#identifier.language + "-" + override);
        if (values.length === 0)
          values = this.#data.hourCycleValues(this.#identifier.language + "-" + this.region());
        cached = values.length === 0 ? ["h23"] : values;
      }
      this.#hours = cached;
    }
    return cached.slice();
  }

  weekData(): number {
    let cached = this.#week;
    if (Number.isNaN(cached)) {
      const override = this.override();
      cached = override === undefined ? NaN : this.#data.weekData(override);
      if (Number.isNaN(cached)) cached = this.#data.weekData(this.region());
      if (Number.isNaN(cached)) cached = this.#data.weekData("001");
      this.#week = cached;
    }
    return cached;
  }
}
