import { LocaleResolver } from "./locale.ts";
import type { LocaleData, NumberLocale } from "./locale.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { numberValue, stringValue, stringOption } from "./options.ts";
import type { RelativeTimePrimitive } from "./relative-data.ts";
import { relativeAuto, relativeUnit, relativeUnitName } from "./relative-unit.ts";
import { FieldSpans } from "./parts.ts";
import { RelativePartBuffer } from "./relative-parts.ts";

const styles: readonly Intl.RelativeTimeFormatStyle[] = ["long", "short", "narrow"];
const numerics: readonly Intl.RelativeTimeFormatNumeric[] = ["always", "auto"];

export class NtsRelativeTimeFormat<D extends LocaleData, P extends RelativeTimePrimitive> {
  readonly #locale: NumberLocale;
  readonly #style: Intl.RelativeTimeFormatStyle;
  readonly #numeric: Intl.RelativeTimeFormatNumeric;
  readonly #primitive: P;
  #parts: RelativePartBuffer | undefined;
  #spans: FieldSpans | undefined;
  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, style: number) => P,
    locales: Intl.LocalesArgument = undefined,
    // The pinned library omits this specified option. Reuse its NumberFormat
    // field rather than maintaining a second numbering-system definition.
    options:
      | Readonly<Intl.RelativeTimeFormatOptions & Pick<Intl.NumberFormatOptions, "numberingSystem">>
      | undefined = undefined,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    this.#locale = resolver.numberLocale(requested, options);
    this.#style = stringOption(options?.style, styles, "long");
    this.#numeric = stringOption(options?.numeric, numerics, "always");
    this.#primitive = open(this.#locale.dataLocale, styles.indexOf(this.#style));
  }
  format(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    const primitive = this.#primitive;
    const number = numberValue(value);
    const text = stringValue(unit);
    if (!Number.isFinite(number)) throw new RangeError("Relative time must be finite");
    const code = relativeUnit(text);
    return primitive.format(number, code, relativeAuto(number, this.#numeric), false);
  }
  formatToParts(value: number, unit: Intl.RelativeTimeFormatUnit): Intl.RelativeTimeFormatPart[] {
    const primitive = this.#primitive;
    const number = numberValue(value);
    const text = stringValue(unit);
    if (!Number.isFinite(number)) throw new RangeError("Relative time must be finite");
    const code = relativeUnit(text);
    const formatted = primitive.format(number, code, relativeAuto(number, this.#numeric), true);
    const count = primitive.fieldCount();
    let spans = this.#spans;
    if (spans === undefined || count > spans.fields.length) {
      spans = new FieldSpans(Math.max(count, spans === undefined ? 16 : spans.fields.length * 2));
      this.#spans = spans;
    }
    spans.count = count;
    for (let index = 0; index < count; index++) {
      spans.fields[index] = primitive.field(index);
      spans.starts[index] = primitive.start(index);
      spans.ends[index] = primitive.end(index);
    }
    let parts = this.#parts;
    if (parts === undefined) this.#parts = parts = new RelativePartBuffer();
    return parts.partition(formatted, spans, relativeUnitName(code));
  }
  resolvedOptions(): Intl.ResolvedRelativeTimeFormatOptions {
    return {
      locale: this.#locale.locale,
      style: this.#style,
      numeric: this.#numeric,
      numberingSystem: this.#locale.numberingSystem,
    };
  }
}
