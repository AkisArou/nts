import { Blob, File } from "./blob.ts";
import { toUSVString } from "../core/webidl.ts";

export type FormDataEntryValue = string | File;

export type FormDataEntry = readonly [name: string, value: FormDataEntryValue];

export class FormData {
  private list: FormDataEntry[] = [];

  append(name: string, value: string | Blob, filename?: string): void {
    this.list.push([toUSVString(name), this.convert(value, filename)]);
  }
  private convert(value: string | Blob, filename?: string): FormDataEntryValue {
    if (typeof value === "string") {
      if (filename !== undefined) throw new TypeError("A filename requires a Blob");
      return toUSVString(value);
    }
    if (value instanceof File && filename === undefined) return value;
    return new File([value], filename ?? "blob", {
      type: value.type,
      lastModified: value instanceof File ? value.lastModified : Date.now(),
    });
  }

  set(name: string, value: string | Blob, filename?: string): void {
    const key = toUSVString(name);
    const converted = this.convert(value, filename);
    let found = false;
    const next: FormDataEntry[] = [];
    for (const item of this.list) {
      if (item[0] !== key) next.push(item);
      else if (!found) {
        next.push([key, converted]);
        found = true;
      }
    }
    if (!found) next.push([key, converted]);
    this.list = next;
  }

  get(name: string): FormDataEntryValue | null {
    return this.list.find((item) => item[0] === toUSVString(name))?.[1] ?? null;
  }

  getAll(name: string): FormDataEntryValue[] {
    const key = toUSVString(name);
    return this.list.filter((item) => item[0] === key).map((item) => item[1]);
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  delete(name: string): void {
    const key = toUSVString(name);
    this.list = this.list.filter((item) => item[0] !== key);
  }

  *entries(): Generator<FormDataEntry, void, unknown> {
    for (let i = 0; i < this.list.length; ++i) {
      const item = this.list[i];
      if (item !== undefined) yield [item[0], item[1]];
    }
  }

  *keys(): Generator<string, void, unknown> {
    for (const item of this.entries()) yield item[0];
  }

  *values(): Generator<FormDataEntryValue, void, unknown> {
    for (const item of this.entries()) yield item[1];
  }

  forEach(
    callback: (this: unknown, value: FormDataEntryValue, name: string, parent: FormData) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }

  [Symbol.iterator](): Generator<FormDataEntry, void, unknown> {
    return this.entries();
  }
}
