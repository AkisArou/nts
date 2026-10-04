import { TimeZoneRegistry } from "./zone-id.ts";
import type { TimeZoneIdentifierData, ResolvedTimeZone } from "./zone-data.ts";
import type { TimeZoneRules } from "./provider.ts";
import { CachedTimeZone } from "./cached-zone.ts";

export class TimeZoneContext<D extends TimeZoneIdentifierData, Z extends TimeZoneRules> {
  readonly #registry: TimeZoneRegistry<D>;
  readonly #open: (identifier: string) => Z;
  readonly #names: string[] = [];
  readonly #zones: CachedTimeZone<Z>[] = [];
  #next = 0;

  constructor(registry: TimeZoneRegistry<D>, open: (identifier: string) => Z) {
    this.#registry = registry;
    this.#open = open;
  }

  resolveNamed(identifier: string): ResolvedTimeZone {
    for (let index = 0; index < this.#names.length; index++)
      if (this.#names[index] === identifier) return this.#zones[index]!;
    const name = this.#registry.resolve(identifier);
    for (let index = 0; index < this.#names.length; index++)
      if (this.#names[index] === name) return this.#zones[index]!;
    // The named identifier belongs to JS semantics. ICU may expose an older
    // canonical spelling, or collapse a requested alias into its target.
    const primaryId = this.#registry.primaryIdentifier(name);
    const zone = new CachedTimeZone(this.#open(name), name, primaryId);
    // Keep provider handles warm without retaining every user-supplied zone.
    if (this.#names.length < 8) {
      this.#names.push(name);
      this.#zones.push(zone);
    } else {
      this.#names[this.#next] = name;
      this.#zones[this.#next] = zone;
    }
    this.#next = (this.#next + 1) % 8;
    return zone;
  }
}
