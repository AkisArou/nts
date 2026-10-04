import { IcuDisplayNames as NativeNames } from "java:nts.intl";
import type { DisplayNamesPrimitive } from "../../../src/intl/display-data.ts";

export class IcuDisplayNames implements DisplayNamesPrimitive {
  readonly #handle: NativeNames;
  constructor(locale: string, type: number, style: number, dialect: boolean) {
    this.#handle = new NativeNames(locale, type, style, dialect);
  }
  name(code: string, field: number): string | undefined {
    return this.#handle.name(code, field) ?? undefined;
  }
}
