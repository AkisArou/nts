import { toUSVString } from "../core/webidl.ts";
import { Blob, File } from "../file/blob.ts";

export type FormDataEntryValue = string | File;

export type FormDataEntry = readonly [name: string, value: FormDataEntryValue];

export class FormData {
  private list: FormDataEntry[] = [];

  append(name: string, value: string | Blob, filename?: string): void {
    this.list.push([toUSVString(name), this.convert(value, filename)]);
  }

  private convert(value: string | Blob, filename?: string): FormDataEntryValue {
    if (typeof value === "string") {
      if (filename !== undefined) {
        throw new TypeError("A filename requires a Blob");
      }
      return toUSVString(value);
    }
    if (value instanceof File && filename === undefined) {
      return value;
    }
    return new File([value], filename ?? "blob", {
      type: value.type,
      lastModified: value instanceof File ? value.lastModified : Date.now(),
    });
  }

  set(name: string, value: string | Blob, filename?: string): void {
    const key = toUSVString(name);
    const converted = this.convert(value, filename);
    let found = false;
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key) {
        this.list[write++] = item;
      } else if (!found) {
        this.list[write++] = [key, converted];
        found = true;
      }
    }
    if (!found) {
      this.list[write++] = [key, converted];
    }
    this.list.length = write;
  }

  get(name: string): FormDataEntryValue | null {
    const key = toUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return item[1];
      }
    }
    return null;
  }

  getAll(name: string): FormDataEntryValue[] {
    const key = toUSVString(name);
    const values: FormDataEntryValue[] = [];
    for (const item of this.list) {
      if (item[0] === key) {
        values.push(item[1]);
      }
    }
    return values;
  }

  has(name: string): boolean {
    const key = toUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return true;
      }
    }
    return false;
  }

  delete(name: string): void {
    const key = toUSVString(name);
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key) {
        this.list[write++] = item;
      }
    }
    this.list.length = write;
  }

  *entries(): Generator<FormDataEntry, void, unknown> {
    for (let i = 0; i < this.list.length; ++i) {
      const item = this.list[i];
      if (item !== undefined) {
        yield [item[0], item[1]];
      }
    }
  }

  *keys(): Generator<string, void, unknown> {
    for (const item of this.entries()) {
      yield item[0];
    }
  }

  *values(): Generator<FormDataEntryValue, void, unknown> {
    for (const item of this.entries()) {
      yield item[1];
    }
  }

  forEach(
    callback: (this: unknown, value: FormDataEntryValue, name: string, parent: FormData) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.entries()) {
      callback.call(thisArg, value, name, this);
    }
  }

  [Symbol.iterator](): Generator<FormDataEntry, void, unknown> {
    return this.entries();
  }
}
