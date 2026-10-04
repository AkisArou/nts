import {
  nts_icu_relative_open,
  nts_icu_relative_format,
  nts_icu_relative_field_count,
  nts_icu_relative_field,
} from "c:nts_icu";
import type { IcuRelativeHandle } from "c:nts_icu";

export class IcuRelativeFormatter {
  readonly #handle: IcuRelativeHandle;
  constructor(locale: string, style: number) {
    const handle = nts_icu_relative_open(locale, style);
    if (handle === null) throw new RangeError("ICU relative formatter could not be opened");
    this.#handle = handle;
  }
  format(value: number, unit: number, auto: boolean, fields: boolean): string {
    const text = nts_icu_relative_format(this.#handle, value, unit, auto, fields);
    if (text === null) throw new RangeError("ICU relative formatting failed");
    return text;
  }
  fieldCount(): number {
    return nts_icu_relative_field_count(this.#handle);
  }
  field(index: number): number {
    return nts_icu_relative_field(this.#handle, index, 0);
  }
  start(index: number): number {
    return nts_icu_relative_field(this.#handle, index, 1);
  }
  end(index: number): number {
    return nts_icu_relative_field(this.#handle, index, 2);
  }
}
