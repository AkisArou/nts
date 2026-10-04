import { nts_icu_display_open, nts_icu_display_name } from "c:nts_icu";
import type { IcuDisplayHandle } from "c:nts_icu";
import type { DisplayNamesPrimitive } from "../../../src/intl/display-data.ts";

export class IcuDisplayNames implements DisplayNamesPrimitive {
  readonly #handle: IcuDisplayHandle;
  constructor(locale: string, type: number, style: number, dialect: boolean) {
    const handle = nts_icu_display_open(locale, type, style, dialect);
    if (handle === null) throw new Error("ICU display-name data could not be opened");
    this.#handle = handle;
  }
  name(code: string, field: number): string | undefined {
    return nts_icu_display_name(this.#handle, code, field) ?? undefined;
  }
}
