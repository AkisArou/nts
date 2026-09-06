import { coerceToUSVString } from "../core/webidl.ts";
import { Blob, File } from "../file/blob.ts";

export type FormDataEntryValue = string | File;

export type FormDataEntry = readonly [name: string, value: FormDataEntryValue];
type OptionalFilename = [] | [filename: string | undefined];

function convertFormDataValue(
  value: string | Blob,
  filename: OptionalFilename,
): FormDataEntryValue {
  if (!(value instanceof Blob)) {
    if (filename.length !== 0) {
      throw new TypeError("A filename requires a Blob");
    }
    return coerceToUSVString(value);
  }
  const suppliedFilename = filename.length === 0 ? undefined : filename[0];
  if (value instanceof File && suppliedFilename === undefined) {
    return value;
  }
  return new File(
    [value],
    suppliedFilename === undefined ? "blob" : coerceToUSVString(suppliedFilename),
    {
      type: value.type,
      lastModified: value instanceof File ? value.lastModified : Date.now(),
    },
  );
}

export class FormData {
  private readonly list: FormDataEntry[] = [];

  append(name: string, value: string): void;
  append(name: string, value: Blob, filename?: string): void;
  append(name: string, value: string | Blob, ...filename: OptionalFilename): void {
    this.list.push([coerceToUSVString(name), convertFormDataValue(value, filename)]);
  }

  set(name: string, value: string): void;
  set(name: string, value: Blob, filename?: string): void;
  set(name: string, value: string | Blob, ...filename: OptionalFilename): void {
    const key = coerceToUSVString(name);
    const converted = convertFormDataValue(value, filename);
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
    const key = coerceToUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return item[1];
      }
    }
    return null;
  }

  getAll(name: string): FormDataEntryValue[] {
    const key = coerceToUSVString(name);
    const values: FormDataEntryValue[] = [];
    for (const item of this.list) {
      if (item[0] === key) {
        values.push(item[1]);
      }
    }
    return values;
  }

  has(name: string): boolean {
    const key = coerceToUSVString(name);
    for (const item of this.list) {
      if (item[0] === key) {
        return true;
      }
    }
    return false;
  }

  delete(name: string): void {
    const key = coerceToUSVString(name);
    let write = 0;
    for (const item of this.list) {
      if (item[0] !== key) {
        this.list[write++] = item;
      }
    }
    this.list.length = write;
  }

  *entries(): Generator<FormDataEntry, void, unknown> {
    for (const item of this.list) {
      yield [item[0], item[1]];
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
