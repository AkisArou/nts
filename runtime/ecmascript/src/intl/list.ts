import { LocaleResolver } from "./locale.ts";
import type { LocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { stringOption } from "./options.ts";
import { ListPatterns } from "./list-pattern.ts";
import type { ListPatternData } from "./list-data.ts";

const matchers: readonly NonNullable<Intl.ListFormatOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const types: readonly Intl.ResolvedListFormatOptions["type"][] = [
  "conjunction",
  "disjunction",
  "unit",
];
const styles: readonly Intl.ResolvedListFormatOptions["style"][] = ["long", "short", "narrow"];

function stringList(value: Iterable<string> | undefined): string[] {
  const items: string[] = [];
  if (value !== undefined) {
    for (const item of value) {
      if (typeof item !== "string") throw new TypeError("List elements must be strings");
      items.push(item);
    }
  }
  return items;
}

export class NtsListFormat<D extends LocaleData & ListPatternData> implements Intl.ListFormat {
  readonly #locale: string;
  readonly #type: Intl.ResolvedListFormatOptions["type"];
  readonly #style: Intl.ResolvedListFormatOptions["style"];
  readonly #patterns: ListPatterns<D>;
  constructor(
    resolver: LocaleResolver<D>,
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.ListFormatOptions> | undefined = undefined,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    if (
      options !== undefined &&
      (options === null || (typeof options !== "object" && typeof options !== "function"))
    )
      throw new TypeError("Intl options must be an object");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    const locale = resolver.resolve(requested, matcher).locale;
    const type = stringOption(options?.type, types, "conjunction");
    const style = stringOption(options?.style, styles, "long");
    this.#locale = locale;
    this.#type = type;
    this.#style = style;
    this.#patterns = new ListPatterns(
      resolver.data,
      locale,
      types.indexOf(type),
      styles.indexOf(style),
    );
  }
  format(value?: Iterable<string>): string {
    const patterns = this.#patterns;
    return patterns.format(stringList(value));
  }
  formatToParts(value?: Iterable<string>): ReturnType<Intl.ListFormat["formatToParts"]> {
    const patterns = this.#patterns;
    return patterns.formatToParts(stringList(value));
  }
  resolvedOptions(): Intl.ResolvedListFormatOptions {
    return { locale: this.#locale, type: this.#type, style: this.#style };
  }
}
