import type { TimeZoneIdentifierData } from "./zone-data.ts";
import { offsetTimeZoneMinutes, formatOffsetTimeZone } from "./offset-zone-id.ts";
export { offsetTimeZoneMinutes, formatOffsetTimeZone } from "./offset-zone-id.ts";

// ICU's icuzones adds Java compatibility links outside the IANA database.
// Keep this pinned provider distinction out of the public identifier set.
const compatibilityZones = new Set<string>([
  "ACT",
  "AET",
  "AGT",
  "ART",
  "AST",
  "BET",
  "BST",
  "CAT",
  "CNT",
  "CST",
  "CTT",
  "EAT",
  "ECT",
  "IET",
  "IST",
  "JST",
  "MIT",
  "NET",
  "NST",
  "PLT",
  "PNT",
  "PRT",
  "PST",
  "SST",
  "VST",
  "Etc/Unknown",
  "US/Pacific-New",
  "Canada/East-Saskatchewan",
]);

// Identifier/data capability. Offsets and case-insensitive lookup are shared
// semantics; the provider supplies the pinned database's names and aliases.
export class TimeZoneRegistry<D extends TimeZoneIdentifierData> {
  readonly #data: D;
  readonly #identifiers = new Map<string, string>();
  readonly #primary = new Map<string, string>();
  #primaryIdentifiers: readonly string[] | undefined;
  constructor(data: D) {
    const names = data.timeZoneNames();
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!;
      // ICU's sentinel isn't an IANA identifier. Temporal's Intl amendments
      // preserve the named Identifier; primary identity is a separate query.
      if (!compatibilityZones.has(name) && !name.startsWith("SystemV/"))
        this.#identifiers.set(name.toLowerCase(), name);
    }
    this.#data = data;
  }
  resolve(identifier: string): string {
    const offset = offsetTimeZoneMinutes(identifier);
    if (offset !== undefined) return formatOffsetTimeZone(offset);
    for (let index = 0; index < identifier.length; index++)
      if (identifier.charCodeAt(index) > 127) throw new RangeError("Time-zone names must be ASCII");
    const canonical = this.#identifiers.get(identifier.toLowerCase());
    if (canonical === undefined) throw new RangeError("Unknown time-zone identifier");
    return canonical;
  }
  defaultIdentifier(): string {
    return this.resolve(this.#data.defaultTimeZoneIdentifier());
  }
  primaryIdentifier(identifier: string): string {
    const name = this.resolve(identifier);
    if (offsetTimeZoneMinutes(name) !== undefined) return name;
    // IANA's factory file defines this Zone. ICU maps it to its non-IANA
    // Etc/Unknown sentinel; that provider spelling is not its JS identity.
    if (name === "Factory") return name;
    let primary = this.#primary.get(name);
    if (primary === undefined) {
      const value = this.#data.primaryTimeZone(name);
      if (value === undefined) throw new RangeError("Unknown primary time-zone identifier");
      primary = value === "Etc/UTC" || value === "Etc/GMT" ? "UTC" : value;
      this.#primary.set(name, primary);
    }
    return primary;
  }
  primaryIdentifiers(): string[] {
    let cached = this.#primaryIdentifiers;
    if (cached === undefined) {
      // One bulk provider call, rather than crossing the ABI for every alias.
      const names = this.#data.primaryTimeZoneNames();
      const unique = new Set<string>();
      for (let index = 0; index < names.length; index++) {
        const name = names[index]!;
        if (!compatibilityZones.has(name) && !name.startsWith("SystemV/"))
          unique.add(name === "Etc/UTC" || name === "Etc/GMT" ? "UTC" : name);
      }
      if (this.#identifiers.has("factory")) unique.add("Factory");
      const values = new Array<string>(unique.size);
      let index = 0;
      for (const name of unique) values[index++] = name;
      cached = values.sort();
      this.#primaryIdentifiers = cached;
    }
    return cached.slice();
  }
}
