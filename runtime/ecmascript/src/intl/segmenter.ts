import { LocaleResolver } from "./locale.ts";
import type { LocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { stringOption, stringValue } from "./options.ts";
import type { SegmenterPrimitive } from "./segment-data.ts";
import { NtsSegments } from "./segments.ts";

const matchers: readonly NonNullable<Intl.SegmenterOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const granularities: readonly Intl.ResolvedSegmenterOptions["granularity"][] = [
  "grapheme",
  "word",
  "sentence",
];

export class NtsSegmenter<D extends LocaleData, P extends SegmenterPrimitive<P>> {
  readonly #locale: string;
  readonly #granularity: Intl.ResolvedSegmenterOptions["granularity"];
  readonly #primitive: P;

  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, granularity: number) => P,
    locales: Intl.LocalesArgument = undefined,
    options?: Readonly<Intl.SegmenterOptions>,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    if (
      options !== undefined &&
      (options === null || (typeof options !== "object" && typeof options !== "function"))
    )
      throw new TypeError("Segmenter options must be an object");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    const locale = resolver.resolve(requested, matcher).locale;
    const granularity = stringOption(options?.granularity, granularities, "grapheme");
    this.#locale = locale;
    this.#granularity = granularity;
    this.#primitive = open(locale, granularities.indexOf(granularity));
  }

  segment(input: string): NtsSegments<P> {
    const primitive = this.#primitive;
    return new NtsSegments(primitive, stringValue(input), this.#granularity === "word");
  }

  resolvedOptions(): Intl.ResolvedSegmenterOptions {
    return { locale: this.#locale, granularity: this.#granularity };
  }
}
