import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import { NtsListFormat } from "../../../../../runtime/ecmascript/src/intl/list.ts";
import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";

// Keep the canonical service contract visible: this witness must not replace
// its Iterable input or library results with an array-only public facade.
export function listPublic<D extends LocaleData & ListPatternData>(data: D): string {
  const formatter = new NtsListFormat(new LocaleResolver(data), "es", { style: "long" });
  const parts = formatter.formatToParts(["A", "iglesia"]);
  return (
    formatter.resolvedOptions().locale +
    ":" +
    formatter.format(["A", "iglesia"]) +
    ":" +
    parts.length
  );
}
