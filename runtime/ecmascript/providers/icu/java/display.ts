import { IcuDisplayNames as NativeNames } from "java:nts.intl";

export class IcuDisplayNames {
  readonly #handle: NativeNames;
  constructor(locale: string, type: number, style: number, dialect: boolean) {
    this.#handle = new NativeNames(locale, type, style, dialect);
  }
  name(code: string, field: number): string | undefined {
    return this.#handle.name(code, field) ?? undefined;
  }
}
