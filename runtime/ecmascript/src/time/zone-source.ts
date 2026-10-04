import { TimeZoneRegistry } from "./zone-id.ts";
import type { TimeZoneIdentifierData, TimeZoneSource } from "./zone-data.ts";
import type { TimeZoneRules } from "./provider.ts";

class NamedTimeZone<Z extends TimeZoneRules> implements TimeZoneRules {
  readonly id: string;
  readonly #rules: Z;
  constructor(id: string, rules: Z) {
    this.id = id;
    this.#rules = rules;
  }
  offsetMilliseconds(milliseconds: number): number {
    return this.#rules.offsetMilliseconds(milliseconds);
  }
  localOffsetMilliseconds(milliseconds: number, former: boolean): number {
    return this.#rules.localOffsetMilliseconds(milliseconds, former);
  }
  transition(milliseconds: number, forward: boolean): number | null {
    return this.#rules.transition(milliseconds, forward);
  }
}

export class TimeZoneContext<
  D extends TimeZoneIdentifierData,
  Z extends TimeZoneRules,
> implements TimeZoneSource {
  readonly #registry: TimeZoneRegistry<D>;
  readonly #open: (identifier: string) => Z;
  readonly #names: string[] = [];
  readonly #zones: NamedTimeZone<Z>[] = [];
  #next = 0;

  constructor(registry: TimeZoneRegistry<D>, open: (identifier: string) => Z) {
    this.#registry = registry;
    this.#open = open;
  }

  resolveNamed(identifier: string): TimeZoneRules {
    for (let index = 0; index < this.#names.length; index++)
      if (this.#names[index] === identifier) return this.#zones[index]!;
    const name = this.#registry.resolve(identifier);
    for (let index = 0; index < this.#names.length; index++)
      if (this.#names[index] === name) return this.#zones[index]!;
    // The named identifier belongs to JS semantics. ICU may expose an older
    // canonical spelling, or collapse a requested alias into its target.
    const zone = new NamedTimeZone(name, this.#open(name));
    // Keep provider handles warm without retaining every user-supplied zone.
    this.#names[this.#next] = name;
    this.#zones[this.#next] = zone;
    this.#next = (this.#next + 1) % 8;
    return zone;
  }
}
