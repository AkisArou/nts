import type { LocaleData } from "./locale-data.ts";
import type { SupportedValueData } from "./supported-value-data.ts";
import type { TimeZoneIdentifierData } from "../time/zone-data.ts";
import { TimeZoneRegistry } from "../time/zone-id.ts";
import { stringValue } from "./options.ts";
import { supportedUnits } from "./units.ts";
import { availableCalendar } from "./calendar-id.ts";

// One service per agent/data environment. No locale matcher or formatter is
// constructed to enumerate implementation-wide data. Private caches never
// escape; the public operation returns a fresh, independently mutable array.
export class SupportedValues<D extends LocaleData & SupportedValueData & TimeZoneIdentifierData> {
  readonly #data: D;
  readonly #zones: TimeZoneRegistry<D>;
  readonly #values = new Array<readonly string[] | undefined>(4);

  constructor(data: D, zones: TimeZoneRegistry<D>) {
    this.#data = data;
    this.#zones = zones;
  }

  of(key: Parameters<typeof Intl.supportedValuesOf>[0]): string[] {
    const name = stringValue(key);
    if (name === "unit") return supportedUnits();
    if (name === "timeZone") return this.#zones.primaryIdentifiers();
    const category =
      name === "calendar"
        ? 0
        : name === "collation"
          ? 1
          : name === "currency"
            ? 2
            : name === "numberingSystem"
              ? 3
              : -1;
    if (category < 0) throw new RangeError("Invalid Intl supported-values key");
    let cached = this.#values[category];
    if (cached === undefined) {
      const raw = this.#data.availableValues(category);
      const unique = new Set<string>();
      for (let index = 0; index < raw.length; index++) {
        const value = raw[index]!;
        if (category === 0) {
          const calendar = this.#data.canonicalType("ca", value);
          if (availableCalendar(calendar)) unique.add(calendar);
        } else if (category === 1) {
          const collation = this.#data.canonicalType("co", value);
          if (collation !== "standard" && collation !== "search") unique.add(collation);
        } else if (category === 2) {
          if (this.#data.hasCurrencyName(value)) unique.add(value);
        } else if (this.#data.hasNumberingSystem(value)) unique.add(value);
      }
      const values = new Array<string>(unique.size);
      let index = 0;
      for (const value of unique) values[index++] = value;
      cached = values.sort();
      this.#values[category] = cached;
    }
    return cached.slice();
  }
}
