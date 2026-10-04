import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import { NtsPluralRules } from "../../../../../runtime/ecmascript/src/intl/plural.ts";
import type { PluralRulesPrimitive } from "../../../../../runtime/ecmascript/src/intl/plural-data.ts";

export function pluralPublic<D extends LocaleData, P extends PluralRulesPrimitive>(
  data: D,
  open: (locale: string, ordinal: boolean, skeleton: string, negativeSkeleton: string) => P,
): string {
  const rules = new NtsPluralRules(new LocaleResolver(data), open, "en-US", {
    maximumFractionDigits: 0,
    roundingMode: "halfCeil",
  });
  return (
    rules.resolvedOptions().locale + ":" + rules.select(-1.5) + ":" + rules.selectRange(1.1, 1.2)
  );
}
