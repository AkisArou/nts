import { coerceToUSVString, requireArguments } from "../core/webidl.ts";
import { Blob, File } from "../file/blob.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";

export type FormDataEntryValue = string | File;

export type FormDataEntry = readonly [name: string, value: FormDataEntryValue];
type StoredFormDataEntry = [name: string, value: FormDataEntryValue];
type FormDataValueArguments = [value?: unknown, filename?: unknown];
type FormDataNameArguments = [name?: unknown];
type FormDataForEachCallback = (
  this: unknown,
  value: FormDataEntryValue,
  name: string,
  parent: FormData,
) => void;

function selectEntry(item: StoredFormDataEntry): FormDataEntry {
  return [item[0], item[1]];
}

function selectName(item: StoredFormDataEntry): string {
  return item[0];
}

function selectValue(item: StoredFormDataEntry): FormDataEntryValue {
  return item[1];
}

class FormDataIterator<T> extends Iterator<T> {
  readonly #list: readonly StoredFormDataEntry[];
  readonly #select: (item: StoredFormDataEntry) => T;
  #position = 0;

  constructor(list: readonly StoredFormDataEntry[], select: (item: StoredFormDataEntry) => T) {
    super();
    this.#list = list;
    this.#select = select;
  }

  next(): IteratorResult<T, undefined> {
    const list = this.#list;
    const position = this.#position;
    if (position >= list.length) {
      return { value: undefined, done: true };
    }
    const item = list[position];
    if (item === undefined) {
      return { value: undefined, done: true };
    }
    this.#position = position + 1;
    return { value: this.#select(item), done: false };
  }

  override get [Symbol.toStringTag](): "FormData Iterator" {
    return "FormData Iterator";
  }
}

function convertFormDataValue(
  value: unknown,
  filenameGiven: boolean,
  rawFilename: unknown,
): FormDataEntryValue {
  if (!(value instanceof Blob)) {
    if (filenameGiven) {
      throw new TypeError("A filename requires a Blob");
    }
    return coerceToUSVString(value);
  }
  const suppliedFilename = rawFilename === undefined ? undefined : coerceToUSVString(rawFilename);
  if (value instanceof File && suppliedFilename === undefined) {
    return value;
  }
  return new File([value], suppliedFilename === undefined ? "blob" : suppliedFilename, {
    type: value.type,
    lastModified:
      value instanceof File
        ? value.lastModified
        : currentWebPlatformRuntime().wallTimeMilliseconds(),
  });
}

export class FormData implements Iterable<FormDataEntry> {
  readonly #list: StoredFormDataEntry[] = [];

  constructor();
  constructor(form: undefined);
  constructor(...args: [] | [form: undefined]) {
    if (args.length !== 0 && args[0] !== undefined) {
      throw new TypeError("FormData constructor does not accept an HTML form in this environment");
    }
  }

  append(name: string, value: string): void;
  append(name: string, value: Blob, filename?: string): void;
  append(name: unknown, ...args: FormDataValueArguments): void {
    const list = this.#list;
    if (args.length === 0) {
      throw new TypeError("FormData.append requires at least 2 argument(s)");
    }
    const key = coerceToUSVString(name);
    const converted = convertFormDataValue(args[0], args.length > 1, args[1]);
    list.push([key, converted]);
  }

  set(name: string, value: string): void;
  set(name: string, value: Blob, filename?: string): void;
  set(name: unknown, ...args: FormDataValueArguments): void {
    const list = this.#list;
    if (args.length === 0) {
      throw new TypeError("FormData.set requires at least 2 argument(s)");
    }
    const key = coerceToUSVString(name);
    const converted = convertFormDataValue(args[0], args.length > 1, args[1]);
    let found = false;
    let write = 0;
    for (const item of list) {
      if (item[0] !== key) {
        list[write++] = item;
      } else if (!found) {
        item[1] = converted;
        list[write++] = item;
        found = true;
      }
    }
    if (!found) {
      list[write++] = [key, converted];
    }
    list.length = write;
  }

  get(name: string): FormDataEntryValue | null;
  get(...args: FormDataNameArguments): FormDataEntryValue | null {
    const list = this.#list;
    requireArguments(args, 1, "FormData.get");
    const key = coerceToUSVString(args[0]);
    for (const item of list) {
      if (item[0] === key) {
        return item[1];
      }
    }
    return null;
  }

  getAll(name: string): FormDataEntryValue[];
  getAll(...args: FormDataNameArguments): FormDataEntryValue[] {
    const list = this.#list;
    requireArguments(args, 1, "FormData.getAll");
    const key = coerceToUSVString(args[0]);
    const values: FormDataEntryValue[] = [];
    for (const item of list) {
      if (item[0] === key) {
        values.push(item[1]);
      }
    }
    return values;
  }

  has(name: string): boolean;
  has(...args: FormDataNameArguments): boolean {
    const list = this.#list;
    requireArguments(args, 1, "FormData.has");
    const key = coerceToUSVString(args[0]);
    for (const item of list) {
      if (item[0] === key) {
        return true;
      }
    }
    return false;
  }

  delete(name: string): void;
  delete(...args: FormDataNameArguments): void {
    const list = this.#list;
    requireArguments(args, 1, "FormData.delete");
    const key = coerceToUSVString(args[0]);
    let write = 0;
    for (const item of list) {
      if (item[0] !== key) {
        list[write++] = item;
      }
    }
    list.length = write;
  }

  entries(): IterableIterator<FormDataEntry> {
    return new FormDataIterator(this.#list, selectEntry);
  }

  keys(): IterableIterator<string> {
    return new FormDataIterator(this.#list, selectName);
  }

  values(): IterableIterator<FormDataEntryValue> {
    return new FormDataIterator(this.#list, selectValue);
  }

  forEach(callback: FormDataForEachCallback, thisArg?: unknown): void {
    const list = this.#list;
    if (typeof callback !== "function") {
      throw new TypeError("FormData.forEach callback must be callable");
    }
    for (const item of list) {
      callback.call(thisArg, item[1], item[0], this);
    }
  }

  [Symbol.iterator](): IterableIterator<FormDataEntry> {
    return new FormDataIterator(this.#list, selectEntry);
  }

  get [Symbol.toStringTag](): "FormData" {
    return "FormData";
  }
}
