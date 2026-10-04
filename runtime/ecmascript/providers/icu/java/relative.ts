import { IcuRelativeFormatter as NativeFormatter } from "java:nts.intl";
import type { RelativeTimePrimitive } from "../../../src/intl/relative-data.ts";

export class IcuRelativeFormatter implements RelativeTimePrimitive {
  readonly #handle: NativeFormatter;
  constructor(locale: string, style: number) {
    this.#handle = new NativeFormatter(locale, style);
  }
  format(value: number, unit: number, auto: boolean, fields: boolean): string {
    return this.#handle.format(value, unit, auto, fields);
  }
  fieldCount(): number {
    return this.#handle.fieldCount();
  }
  field(index: number): number {
    return this.#handle.field(index);
  }
  start(index: number): number {
    return this.#handle.start(index);
  }
  end(index: number): number {
    return this.#handle.end(index);
  }
}
